/**
 * intent-classifier.ts
 * The retrieval gate for the Ollama path (Feature 1).
 *
 * A lightweight classifier prompt looks at the last few conversation turns plus
 * the newest user message and returns one of:
 *   retrieve — the user's own past words would genuinely help
 *   converse — respond conversationally, no archive lookup
 *   escalate — crisis signals; suggest professional help
 *
 * (The Gemini path doesn't use this — it gates retrieval via the
 * search_journal tool declared in ai-provider.ts.)
 */

import { complete } from "./ai-provider.js";
import type { ChatMessage } from "./types.js";

export type Intent = "retrieve" | "converse" | "escalate";

/** How many trailing conversation turns the classifier sees (incl. the new message). */
const CONTEXT_TURNS = 4;

const CLASSIFIER_SYSTEM =
  "You are an intent classifier for a journaling companion app. " +
  "Respond with exactly one word: retrieve, converse, or escalate. No other output.";

const CLASSIFIER_PROMPT = `Decide whether the assistant should search the user's past journal entries before replying.

Answer "converse" — respond conversationally, do NOT search — when the user is venting, opening a topic, replying to advice, making small talk, or giving a low-signal check-in:
- "I had a really long day at work today." → converse (venting; listen and ask what made it long)
- "I've been thinking about whether I should switch careers." → converse (opening a topic; explore the thought first)
- "Yeah that makes sense, I'll try that." → converse (responding to previous advice; continue naturally)
- "How are you?" → converse (general conversation)
- "I feel okay today, nothing special." → converse (low-signal; respond warmly, gentle follow-up)

Answer "retrieve" — search the journal — when the user's own past words would genuinely help:
- "I feel like I keep making the same mistakes over and over." → retrieve (pattern signal; pull entries with similar frustration)
- "I don't know what I actually want anymore." → retrieve (identity/values confusion; pull entries about goals, aspirations, clarity moments)
- "I'm proud of myself today, I actually did the thing I was scared of." → retrieve (growth moment; pull the past entry where they expressed that fear — show the arc)
- "Nothing I do matters, what's the point." → retrieve (hopelessness signal; pull entries where they expressed purpose or accomplishment)
- "I feel exactly like I did during my first year of college." → retrieve (explicit self-reference to their own past)

Answer "escalate" — suggest professional help — when there are crisis signals:
- Persistent hopelessness repeated across multiple turns of the conversation
- Any self-harm or suicidal language
- Severe distress beyond what a journaling companion can support

Recent conversation:
{{CONVERSATION}}

Newest user message:
"{{MESSAGE}}"

One word (retrieve, converse, or escalate):`;

function parseIntent(raw: string): Intent | null {
  const word = raw.trim().toLowerCase();
  // Tolerate minor decoration ("**converse**", "converse.") from small models
  if (/\bescalate\b/.test(word)) return "escalate";
  if (/\bretrieve\b/.test(word)) return "retrieve";
  if (/\bconverse\b/.test(word)) return "converse";
  return null;
}

/**
 * Classify the newest user message in context. Any failure (unreachable model,
 * garbage output) degrades to "converse" — the safe default that keeps the
 * conversation flowing without retrieval.
 */
export async function classifyIntent(
  messages: ChatMessage[],
  apiKey: string
): Promise<Intent> {
  const latest = messages[messages.length - 1];
  const history = messages.slice(0, -1).slice(-(CONTEXT_TURNS - 1));

  const conversation =
    history.length > 0
      ? history
          .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
          .join("\n")
      : "(start of conversation)";

  const prompt = CLASSIFIER_PROMPT
    .replace("{{CONVERSATION}}", conversation)
    .replace("{{MESSAGE}}", latest.content);

  try {
    const raw = await complete(prompt, CLASSIFIER_SYSTEM, apiKey);
    const intent = parseIntent(raw);
    if (!intent) {
      console.warn(`[WARN] classifier returned unparseable output: "${raw.slice(0, 60)}"`);
      return "converse";
    }
    return intent;
  } catch (e) {
    console.error("[ERROR] classifyIntent failed:", (e as Error).message);
    return "converse";
  }
}
