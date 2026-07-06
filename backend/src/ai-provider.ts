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
import type { ChatMessage, MoodData } from "./types.js";

const PROVIDER = config.aiProvider;
const OLLAMA_URL = config.ollamaUrl;
const OLLAMA_MODEL = config.ollamaModel;
const GEMINI_MODEL = config.geminiModel;

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
  systemInstruction?: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    ...(systemInstruction ? { config: { systemInstruction } } : {}),
  });
  return (response.text ?? "").trim();
}

async function geminiChat(
  messages: ChatMessage[],
  systemInstruction: string,
  apiKey: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: toGeminiContents(messages),
    config: { systemInstruction },
  });
  return (response.text ?? "").trim();
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
  const ai = new GoogleGenAI({ apiKey });
  const contents: Content[] = toGeminiContents(messages);

  const first = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: [searchJournalDeclaration] }],
    },
  });

  const call = first.functionCalls?.[0];
  if (!call || call.name !== "search_journal") {
    return { reply: (first.text ?? "").trim(), searched: false, searchQuery: null };
  }

  const query = String((call.args as { query?: string } | undefined)?.query ?? "");
  let searchResult: string;
  try {
    searchResult = await onSearch(query);
  } catch (e) {
    console.error("[ERROR] search_journal retrieval failed:", (e as Error).message);
    searchResult = "Search failed — answer from the conversation alone.";
  }

  // Feed the tool result back for the final grounded answer
  contents.push(first.candidates?.[0]?.content ?? { role: "model", parts: [{ functionCall: call }] });
  contents.push({
    role: "user",
    parts: [{ functionResponse: { name: "search_journal", response: { result: searchResult } } }],
  });

  const second = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: [searchJournalDeclaration] }],
    },
  });

  return { reply: (second.text ?? "").trim(), searched: true, searchQuery: query };
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
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
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
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = (await res.json()) as { message: { content: string } };
  return data.message.content.trim();
}

/** Quick liveness probe used to pick the Ollama vs Gemini code path per request. */
export async function isOllamaUp(): Promise<boolean> {
  if (PROVIDER !== "ollama") return false;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Smart fallback helper ────────────────────────────────────────────────────

function isOllamaUnreachable(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === "TimeoutError" ||
    e.code === "ECONNREFUSED" ||
    !!e.message?.includes("ECONNREFUSED") ||
    !!e.message?.includes("fetch failed") ||
    !!e.message?.includes("Ollama error")
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Provider-aware one-shot completion (Ollama primary → Gemini fallback).
 * Used by the intent classifier and other utility prompts.
 */
export async function complete(prompt: string, system: string, apiKey: string): Promise<string> {
  if (PROVIDER === "ollama") {
    try {
      return await ollamaComplete(prompt, system);
    } catch (e) {
      if (isOllamaUnreachable(e)) {
        console.warn("⚠️  Ollama unreachable, falling back to Gemini for completion");
        return geminiComplete(prompt, apiKey, system);
      }
      throw e;
    }
  }
  return geminiComplete(prompt, apiKey, system);
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
      return await ollamaChat(messages, systemPrompt);
    } catch (e) {
      if (isOllamaUnreachable(e)) {
        console.warn("⚠️  Ollama unreachable, falling back to Gemini for chat");
        return geminiChat(messages, systemPrompt, apiKey);
      }
      throw e;
    }
  }
  return geminiChat(messages, systemPrompt, apiKey);
}

/**
 * Score the emotional mood of a journal entry from its text.
 * Returns { score, label } using our synonym table for the label, or null on failure.
 */
export async function scoreMood(text: string, apiKey: string): Promise<MoodData | null> {
  // Only ask the AI for the NUMBER — we use our own vocabulary for the label.
  const prompt = `Score the emotional mood of this journal entry on a scale of 1-10.
1 = deeply negative/distressed, 5 = neutral, 10 = very positive/joyful.
Respond with ONLY a single integer between 1 and 10. Nothing else.

Entry: "${text}"`;

  const system = "You score the emotional tone of journal entries. Respond with only a single integer 1-10.";

  const parseScore = (raw: string): number => {
    const n = parseInt(raw.trim().replace(/[^0-9]/g, ""), 10);
    if (isNaN(n) || n < 1 || n > 10) throw new Error(`Invalid score: ${raw}`);
    return n;
  };

  try {
    const raw = await complete(prompt, system, apiKey);
    const score = parseScore(raw);
    return { score, label: moodLabel(score) };
  } catch (e) {
    console.error("scoreMood failed:", (e as Error).message);
    return null;
  }
}
