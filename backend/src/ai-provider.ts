/**
 * ai-provider.ts
 * Abstracts Gemini (@google/genai) and Ollama behind a single interface.
 * Smart fallback: if Ollama is unreachable, retries via Gemini.
 *
 * Public surface:
 *  - scoreMood(text, apiKey)                      — 1-10 mood score (behavior unchanged)
 *  - complete(prompt, system, apiKey)             — provider-aware one-shot completion
 *  - generateChat(messages, system, apiKey)       — provider-aware chat reply
 *  - geminiChatWithSearchTool(...)                — Gemini tool-calling loop (search_journal)
 *  - isOllamaUp()                                 — quick liveness probe for path selection
 *  - moodLabel(score)
 */

import { GoogleGenAI, Type } from "@google/genai";
import type { Content, FunctionDeclaration } from "@google/genai";
import { config } from "./config.js";
import {
  breakers,
  UpstreamError,
  parseRetryAfterHeader,
  withRetry,
  withTimeout,
} from "./lib/resilience.js";
import { MoodScoreSchema, geminiSchemas, parseStructured } from "./lib/schemas.js";
import type { ChatMessage, MoodData } from "./types.js";

const PROVIDER = config.aiProvider;
const OLLAMA_URL = config.ollamaUrl;
const OLLAMA_MODEL = config.ollamaModel;
const GEMINI_MODEL = config.geminiModel;

// ─── Client reuse ─────────────────────────────────────────────────────────────
// One client per API key instead of `new GoogleGenAI()` on every call, so the
// underlying HTTP agent and its connection pool are actually reused.
const clients = new Map<string, GoogleGenAI>();
function geminiClient(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

/**
 * A finish reason other than STOP means the response is incomplete — truncated
 * at MAX_TOKENS or stopped by a safety filter. Previously `response.text ?? ""`
 * swallowed both into an empty string, which surfaced downstream as a generic
 * "empty reply from model" 500, indistinguishable from a network failure.
 */
function assertComplete(response: {
  text?: string;
  candidates?: { finishReason?: unknown }[];
}): void {
  const reason = String(response.candidates?.[0]?.finishReason ?? "STOP");
  if (reason !== "STOP" && reason !== "undefined") {
    throw new UpstreamError(`Generation stopped early: finishReason=${reason}`, 502);
  }
}

// ─── Mood label vocabulary ────────────────────────────────────────────────────
// Each score maps to a pool of synonyms. One is picked randomly at save time
// and stored permanently — so reading back entries feels rich and varied.
const MOOD_LABELS: Record<number, string[]> = {
  1:  ["Devastated", "Shattered", "Broken", "Crushed"],
  2:  ["Distressed", "Anguished", "Overwhelmed", "Miserable"],
  3:  ["Down", "Heavy", "Blue", "Sad"],
  4:  ["Low", "Drained", "Flat", "Blah"],
  5:  ["Neutral", "Still", "Present", "Just here"],
  6:  ["Steady", "Balanced", "Settled", "Okay"],
  7:  ["Calm", "Grounded", "At ease", "Peaceful"],
  8:  ["Hopeful", "Bright", "Lifted", "Good"],
  9:  ["Energized", "Alive", "Vibrant", "Charged"],
  10: ["Joyful", "Radiant", "Thriving", "Elated"],
};

/**
 * Returns a randomly selected label word for a given score (1–10).
 * The picked word is stored in the DB, so it stays consistent for that entry.
 */
export function moodLabel(score: number): string {
  const synonyms = MOOD_LABELS[Math.round(Math.max(1, Math.min(10, score)))];
  if (!synonyms) return "Neutral";
  return synonyms[Math.floor(Math.random() * synonyms.length)];
}

// ─── Gemini Helpers ──────────────────────────────────────────────────────────

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

async function geminiComplete(
  prompt: string,
  apiKey: string,
  systemInstruction?: string,
  model: string = GEMINI_MODEL
): Promise<string> {
  return breakers.gemini.run(() =>
    withRetry(
      () =>
        withTimeout(config.timeouts.geminiUtility, async (abortSignal) => {
          const response = await geminiClient(apiKey).models.generateContent({
            model,
            contents: prompt,
            config: {
              ...(systemInstruction ? { systemInstruction } : {}),
              abortSignal,
            },
          });
          assertComplete(response);
          return (response.text ?? "").trim();
        }),
      { label: `gemini.complete(${model})` }
    )
  );
}

async function geminiChat(
  messages: ChatMessage[],
  systemInstruction: string,
  apiKey: string,
  model: string = GEMINI_MODEL
): Promise<string> {
  return breakers.gemini.run(() =>
    withRetry(
      () =>
        withTimeout(config.timeouts.geminiChat, async (abortSignal) => {
          const response = await geminiClient(apiKey).models.generateContent({
            model,
            contents: toGeminiContents(messages),
            config: { systemInstruction, abortSignal },
          });
          assertComplete(response);
          return (response.text ?? "").trim();
        }),
      { label: `gemini.chat(${model})` }
    )
  );
}

// ─── Gemini tool-calling: search_journal ─────────────────────────────────────

const searchJournalDeclaration: FunctionDeclaration = {
  name: "search_journal",
  description:
    "Search the user's past journal entries by meaning. Call this ONLY when the user's own " +
    "past words would genuinely help: pattern signals ('I keep making the same mistakes'), " +
    "identity/values confusion, growth moments worth contrasting with past fears, hopelessness " +
    "that past purpose could counter, or explicit references to their own past. Do NOT call it " +
    "for ordinary venting, general conversation, or low-signal check-ins — respond " +
    "conversationally instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "What to search for in the user's own words — a feeling, theme, or situation " +
          "(e.g. 'feeling stuck repeating mistakes', 'moments of pride and accomplishment').",
      },
    },
    required: ["query"],
  },
};

export interface ToolChatResult {
  reply: string;
  searched: boolean;
  searchQuery: string | null;
}

/** Tool-calling rounds before we force a tool-free answer. */
const MAX_TOOL_TURNS = 3;

/**
 * Gemini-path chat with the search_journal tool. When the model invokes the tool,
 * `onSearch(query)` runs retrieval and its result is fed back for the final answer.
 */
export async function geminiChatWithSearchTool(
  messages: ChatMessage[],
  systemInstruction: string,
  apiKey: string,
  onSearch: (query: string) => Promise<string>
): Promise<ToolChatResult> {
  const contents: Content[] = toGeminiContents(messages);
  const tools = [{ functionDeclarations: [searchJournalDeclaration] }];

  const generate = (model: string) =>
    breakers.gemini.run(() =>
      withRetry(
        () =>
          withTimeout(config.timeouts.geminiChat, async (abortSignal) =>
            geminiClient(apiKey).models.generateContent({
              model,
              contents,
              config: { systemInstruction, tools, abortSignal },
            })
          ),
        { label: `gemini.tool(${model})` }
      )
    );

  let searched = false;
  let searchQuery: string | null = null;

  // Bounded loop rather than a fixed two-turn exchange. The old shape read only
  // functionCalls[0] and made the second call terminal, so if the model called
  // the tool again its reply was empty and the route 500-ed.
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await generate(GEMINI_MODEL);
    const calls = (response.functionCalls ?? []).filter((c) => c.name === "search_journal");

    if (calls.length === 0) {
      assertComplete(response);
      return { reply: (response.text ?? "").trim(), searched, searchQuery };
    }

    contents.push(
      response.candidates?.[0]?.content ?? {
        role: "model",
        parts: calls.map((c) => ({ functionCall: c })),
      }
    );

    // Handle every call the model made this turn, not just the first
    for (const call of calls) {
      const query = String((call.args as { query?: string } | undefined)?.query ?? "");
      searched = true;
      searchQuery ??= query;
      let result: string;
      try {
        result = await onSearch(query);
      } catch (e) {
        console.error("[ERROR] search_journal retrieval failed:", (e as Error).message);
        result = "Search failed — answer from the conversation alone.";
      }
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: "search_journal", response: { result } } }],
      });
    }
  }

  // Budget exhausted — ask once more with tools withheld so it must answer.
  const final = await breakers.gemini.run(() =>
    withRetry(
      () =>
        withTimeout(config.timeouts.geminiChat, async (abortSignal) =>
          geminiClient(apiKey).models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: { systemInstruction, abortSignal },
          })
        ),
      { label: "gemini.tool(final)" }
    )
  );
  return { reply: (final.text ?? "").trim(), searched, searchQuery };
}

// ─── Ollama Helpers ──────────────────────────────────────────────────────────

async function ollamaComplete(prompt: string, system?: string): Promise<string> {
  const body = {
    model: OLLAMA_MODEL,
    prompt: system ? `${system}\n\n${prompt}` : prompt,
    stream: false,
    // Deterministic output — complete() serves classification/scoring prompts
    // where sampling variance only hurts.
    options: { temperature: 0 },
  };
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeouts.ollamaComplete),
  });
  if (!res.ok) {
    throw new UpstreamError(`Ollama error: ${res.status}`, res.status, parseRetryAfterHeader(res));
  }
  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

async function ollamaChat(messages: ChatMessage[], system?: string): Promise<string> {
  const ollamaMessages = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages: ollamaMessages, stream: false }),
    signal: AbortSignal.timeout(config.timeouts.ollamaChat),
  });
  if (!res.ok) {
    throw new UpstreamError(`Ollama error: ${res.status}`, res.status, parseRetryAfterHeader(res));
  }
  const data = (await res.json()) as { message: { content: string } };
  return data.message.content.trim();
}

/** Liveness probe used to pick the Ollama vs Gemini path. Memoized: this used
 *  to run on every chat turn, costing up to 1.5s each time. */
let probeCache: { at: number; up: boolean } | null = null;
export async function isOllamaUp(): Promise<boolean> {
  if (PROVIDER !== "ollama") return false;
  if (probeCache && Date.now() - probeCache.at < config.ollamaProbeTtlMs) {
    return probeCache.up;
  }
  let up = false;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(config.timeouts.ollamaProbe),
    });
    up = res.ok;
  } catch {
    up = false;
  }
  probeCache = { at: Date.now(), up };
  return up;
}

// ─── Smart fallback helper ────────────────────────────────────────────────────

/**
 * True only when Ollama is genuinely unreachable or broken server-side.
 *
 * The previous version matched `message.includes("Ollama error")` — a string
 * thrown for EVERY non-2xx — so a 400 Bad Request (our bug) was misread as
 * "server down" and silently escalated to Gemini, burning paid quota to hide a
 * malformed request.
 */
function isOllamaUnreachable(err: unknown): boolean {
  if (err instanceof UpstreamError) return err.status >= 500 || err.status === 429;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e?.name === "TimeoutError" ||
    e?.name === "AbortError" ||
    e?.code === "ECONNREFUSED" ||
    !!e?.message?.includes("ECONNREFUSED") ||
    !!e?.message?.includes("fetch failed")
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Provider-aware one-shot completion (Ollama primary → Gemini fallback).
 * Used by the intent classifier and mood scoring — utility calls, so the
 * Gemini path uses the cheap lite model (separate quota from chat).
 */
export async function complete(prompt: string, system: string, apiKey: string): Promise<string> {
  if (PROVIDER === "ollama") {
    try {
      return await breakers.ollama.run(() => ollamaComplete(prompt, system));
    } catch (e) {
      if (isOllamaUnreachable(e)) {
        console.warn("⚠️  Ollama unreachable, falling back to Gemini for completion");
        return geminiComplete(prompt, apiKey, system, config.geminiUtilityModel);
      }
      throw e;
    }
  }
  return geminiComplete(prompt, apiKey, system, config.geminiUtilityModel);
}

/**
 * Provider-aware chat reply with a caller-supplied system prompt
 * (Ollama primary → Gemini fallback).
 */
export async function generateChat(
  messages: ChatMessage[],
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  if (PROVIDER === "ollama") {
    try {
      return await breakers.ollama.run(() => ollamaChat(messages, systemPrompt));
    } catch (e) {
      if (isOllamaUnreachable(e)) {
        console.warn("⚠️  Ollama unreachable, falling back to Gemini for chat");
        return geminiChatWithFallbacks(messages, systemPrompt, apiKey);
      }
      throw e;
    }
  }
  return geminiChatWithFallbacks(messages, systemPrompt, apiKey);
}

/**
 * Walk the model chain (primary → configured fallbacks) before giving up.
 * A model being overloaded or quota-exhausted shouldn't end the conversation
 * when a sibling model can answer.
 */
async function geminiChatWithFallbacks(
  messages: ChatMessage[],
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const chain = [GEMINI_MODEL, ...config.geminiChatFallbacks];
  let lastErr: unknown;
  for (const model of chain) {
    try {
      return await geminiChat(messages, systemPrompt, apiKey, model);
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️  chat model ${model} failed: ${(e as Error).message?.slice(0, 120)}`);
    }
  }
  throw lastErr;
}

/**
 * Score the emotional mood of a journal entry from its text.
 * Returns { score, label } using our synonym table for the label, or null on failure.
 */
export async function scoreMood(text: string, apiKey: string): Promise<MoodData | null> {
  // Only ask the AI for the NUMBER — we use our own vocabulary for the label.
  const prompt = `Score the emotional mood of this journal entry on a scale of 1-10.
1 = deeply negative/distressed, 5 = neutral, 10 = very positive/joyful.
Respond with JSON: {"score": <integer 1-10>}

Entry: "${text}"`;

  const system =
    "You score the emotional tone of journal entries. " +
    'Respond with only JSON of the form {"score": 7}.';

  try {
    // Gemini path constrains generation with responseSchema; Ollama path is
    // free-form, so Zod is what actually guarantees the shape on both.
    const raw =
      PROVIDER === "ollama"
        ? await complete(prompt, system, apiKey)
        : await geminiJson(prompt, system, apiKey, geminiSchemas.moodScore);

    const { score } = await parseStructured(raw, MoodScoreSchema);
    return { score, label: moodLabel(score) };
  } catch (e) {
    console.error("scoreMood failed:", (e as Error).message);
    return null;
  }
}

/** One-shot Gemini call constrained to a JSON schema. */
async function geminiJson(
  prompt: string,
  systemInstruction: string,
  apiKey: string,
  responseSchema: unknown,
  model: string = config.geminiUtilityModel
): Promise<string> {
  return breakers.gemini.run(() =>
    withRetry(
      () =>
        withTimeout(config.timeouts.geminiUtility, async (abortSignal) => {
          const response = await geminiClient(apiKey).models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              // SDK types don't model the schema object; validated by Zod after
              responseSchema: responseSchema as never,
              abortSignal,
            },
          });
          assertComplete(response);
          return (response.text ?? "").trim();
        }),
      { label: `gemini.json(${model})` }
    )
  );
}
