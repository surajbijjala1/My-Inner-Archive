/**
 * safety-classifier.ts
 * The crisis-detection gate — runs on EVERY chat turn, on every provider path.
 *
 * Why this exists separately from intent-classifier.ts: escalation used to be
 * one of three labels returned by the retrieval gate, which only runs on the
 * Ollama path. In the default Gemini deployment that classifier never executes,
 * so ESCALATION_DIRECTIVE was unreachable in production. Safety cannot depend on
 * which provider happens to be serving the request, and it must not depend on
 * the model *choosing* to call a tool — the failure mode of a tool is silent
 * non-invocation. So this is a separate, always-on, deterministic check.
 *
 * Fail-safe direction: a classifier failure falls back to a keyword pre-filter
 * rather than returning "no crisis". Escalation is warm and non-clinical, so a
 * false positive costs little; a false negative is the expensive one.
 */

import { complete } from "./ai-provider.js";
import type { ChatMessage } from "./types.js";

/** Trailing turns the classifier sees (incl. the newest message). */
const CONTEXT_TURNS = 4;

const SAFETY_SYSTEM =
  "You are a safety classifier for a journaling companion app. " +
  "Respond with exactly one word: crisis or safe. No other output.";

const SAFETY_PROMPT = `Decide whether the user's newest message shows crisis signals that need professional support rather than a journaling companion.

Answer "crisis" when there is:
- Any suicidal ideation, intent, or planning — explicit or veiled ("I want to go to sleep and not wake up")
- Any self-harm language, current or intended
- Hopelessness that persists across multiple turns of this conversation
- Severe distress beyond what a reflective companion can hold (panic that won't subside, dissociation, being unsafe right now)
- Reference to means, timing, or goodbyes

Answer "safe" for ordinary difficulty — sadness, stress, burnout, frustration, grief, loneliness, self-criticism, or venting. These are the normal substance of journaling and must NOT be escalated; over-escalation makes the companion unusable and teaches the user to hide.

Judge the emotional reality, not keywords. "This deadline is killing me" is safe. "I don't see the point in any of it anymore" following several turns of hopelessness is crisis.

Recent conversation:
{{CONVERSATION}}

Newest user message:
"{{MESSAGE}}"

One word (crisis or safe):`;

/**
 * High-signal phrases used only when the model call fails. Deliberately narrow —
 * this is a safety net for an outage, not the primary detector, so it targets
 * unambiguous statements and accepts that it misses veiled phrasing.
 */
const CRISIS_PATTERNS: RegExp[] = [
  // Word forms matter: a 503 storm in an eval showed "I've been seriously
  // thinking about ENDING my life" slipping past a pattern that only knew "end".
  /\bkill(ing|ed)?\s+myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\b(end|ending|ended)\s+(my\s+(own\s+)?life|it\s+all)\b/i,
  // …but not recovery language: "taking my life back", "take my life in a new direction".
  /\b(take|taking|took)\s+my\s+(own\s+)?life\b(?!\s+(back|in|into)\b)/i,
  /\b(don'?t|do\s+not)\s+want\s+to\s+(be\s+here|be\s+alive|live|wake\s+up)\b/i,
  /\bsleep\s+and\s+(never|not)\s+wake\s+up\b/i,
  /\b(wish|want)\s+(i\s+)?(was|were|to\s+be)\s+dead\b/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|being\s+alive)\b/i,
  /\bbetter\s+off\s+(dead|without\s+me)\b/i,
  /\b(hurt|hurting|harm|harming)\s+myself\b/i,
  /\bself[-\s]harm/i,
  /\bcut(ting)?\s+myself\b/i,
  /\bwant(s|ed)?\s+to\s+die\b/i,
];

/** Keyword fallback — only consulted when the classifier call itself fails. */
export function matchesCrisisKeywords(text: string): boolean {
  return CRISIS_PATTERNS.some((re) => re.test(text));
}

function parseVerdict(raw: string): boolean | null {
  const word = raw.trim().toLowerCase();
  // Check "crisis" first: if a chatty model emits both, the unsafe reading wins.
  if (/\bcrisis\b/.test(word)) return true;
  if (/\bsafe\b/.test(word)) return false;
  return null;
}

/** Verdict plus where it came from, so evals can tell a classifier answer
 *  from the keyword fallback (an outage shouldn't read as a missed crisis). */
export interface CrisisVerdict {
  crisis: boolean;
  source: "model" | "keywords";
}

/**
 * Classify the newest message for crisis signals.
 *
 * Runs on every turn regardless of provider, concurrently with drafting the
 * reply (see routes/ai.ts) — one cheap utility-model call.
 */
export async function classifyCrisis(
  messages: ChatMessage[],
  apiKey: string
): Promise<CrisisVerdict> {
  const latest = messages[messages.length - 1];
  if (!latest) return { crisis: false, source: "keywords" };

  const history = messages.slice(0, -1).slice(-(CONTEXT_TURNS - 1));
  const conversation =
    history.length > 0
      ? history
          .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
          .join("\n")
      : "(start of conversation)";

  const prompt = SAFETY_PROMPT
    .replace("{{CONVERSATION}}", conversation)
    .replace("{{MESSAGE}}", latest.content);

  const fallback = (): CrisisVerdict => ({ crisis: matchesCrisisKeywords(latest.content), source: "keywords" });
  try {
    const raw = await complete(prompt, SAFETY_SYSTEM, apiKey);
    const verdict = parseVerdict(raw);
    if (verdict === null) {
      console.warn(`[WARN] safety classifier unparseable: "${raw.slice(0, 60)}"`);
      return fallback();
    }
    return { crisis: verdict, source: "model" };
  } catch (e) {
    // Fail toward safety: an outage must not silently disable escalation.
    console.error("[ERROR] detectCrisis failed, using keyword fallback:", (e as Error).message);
    return fallback();
  }
}

/** True when the newest message shows crisis signals. */
export async function detectCrisis(messages: ChatMessage[], apiKey: string): Promise<boolean> {
  return (await classifyCrisis(messages, apiKey)).crisis;
}
