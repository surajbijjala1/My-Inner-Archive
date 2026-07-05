/**
 * ai-provider.ts
 * Abstracts Gemini and Ollama behind a single interface.
 * Smart fallback: if Ollama is unreachable, retries via Gemini.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
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

async function geminiComplete(
  prompt: string,
  apiKey: string,
  systemInstruction?: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    ...(systemInstruction ? { systemInstruction } : {}),
  });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function geminiChat(
  messages: ChatMessage[],
  systemInstruction: string,
  apiKey: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    ...(systemInstruction ? { systemInstruction } : {}),
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const lastMsg = messages[messages.length - 1].content;

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMsg);
  return result.response.text().trim();
}

// ─── Ollama Helpers ──────────────────────────────────────────────────────────

async function ollamaComplete(prompt: string, system?: string): Promise<string> {
  const body = {
    model: OLLAMA_MODEL,
    prompt: system ? `${system}\n\n${prompt}` : prompt,
    stream: false,
  };
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
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
    let score: number;

    if (PROVIDER === "ollama") {
      try {
        const raw = await ollamaComplete(prompt, system);
        score = parseScore(raw);
      } catch (e) {
        if (isOllamaUnreachable(e)) {
          console.warn("⚠️  Ollama unreachable, falling back to Gemini for mood scoring");
          const raw = await geminiComplete(prompt, apiKey, system);
          score = parseScore(raw);
        } else {
          throw e;
        }
      }
    } else {
      const raw = await geminiComplete(prompt, apiKey, system);
      score = parseScore(raw);
    }

    return { score, label: moodLabel(score) };
  } catch (e) {
    console.error("scoreMood failed:", (e as Error).message);
    return null;
  }
}

/**
 * Generate an AI chat reply grounded in the user's journal entries.
 */
export async function chat(
  messages: ChatMessage[],
  journalContext: string,
  apiKey: string
): Promise<string> {
  const system = `You are a deeply personal AI companion for "My Inner Archive."
Your only knowledge comes from the user's journal entries below. Never reference outside quotes or generic advice.

JOURNAL ENTRIES (newest first):
${journalContext}

Guidelines:
- When the user shares a feeling, find matching entries from the past — cite the exact date and their own words.
- Notice patterns in context/activity. Surface them gently (e.g. "You seem to think most clearly when walking").
- Use **bold** for key phrases and dates. Keep responses concise and personal.
- Be warm, grounded entirely in their words. Never make things up.`;

  if (PROVIDER === "ollama") {
    try {
      return await ollamaChat(messages, system);
    } catch (e) {
      if (isOllamaUnreachable(e)) {
        console.warn("⚠️  Ollama unreachable, falling back to Gemini for chat");
        return geminiChat(messages, system, apiKey);
      }
      throw e;
    }
  } else {
    return geminiChat(messages, system, apiKey);
  }
}
