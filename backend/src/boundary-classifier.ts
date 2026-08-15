/**
 * boundary-classifier.ts
 * The relational-boundary gate: keeps every persona a companion rather than a
 * romantic or sexual partner, including inside fiction and roleplay.
 *
 * Why this exists as code and not just prompt text: the boundary lived only in
 * the system prompt, and roleplay defeated it reliably. Assigning a character
 * and describing a scene shifts the frame — the model reasons it isn't BEING a
 * partner, it's DEPICTING one — and escalation is gradual enough that no single
 * turn looks like a violation. A rule stated once, mid-prompt, under thousands
 * of tokens of persona and history, is a suggestion.
 *
 * Two checks, because input-only filtering is the classic mistake:
 *   checkUserTurn  — is the user steering toward romance/sexual roleplay?
 *   checkReply     — did OUR OWN OUTPUT cross the line, however it got there?
 *
 * The output check is the one that actually holds. It doesn't care what
 * technique elicited the text; it reads what we were about to send.
 *
 * IMPORTANT distinction both checks encode: the user's OWN romantic life is
 * legitimate journaling material. Discussing their marriage, dating, heartbreak
 * or attraction is core to the product. What's forbidden is the COMPANION being
 * a romantic party in the exchange.
 */

import { complete } from "./ai-provider.js";
import type { ChatMessage } from "./types.js";

/** Trailing turns the classifiers see — enough to catch gradual drift. */
const CONTEXT_TURNS = 6;

// ─── Cheap prefilter ─────────────────────────────────────────────────────────

/**
 * Fast heuristics over the assistant's own reply. Used to decide whether to
 * spend a model call, and as the fallback verdict if that call fails — so a
 * classifier outage can't silently disable the gate.
 *
 * Only patterns that are damning coming FROM the companion. Deliberately does
 * not include ordinary warmth ("I care about you", "I'm here") — that's the
 * product working.
 */
const REPLY_VIOLATION_PATTERNS: RegExp[] = [
  // Declarations of romantic love from the companion
  /\bi(?:'m| am)? ?(?:in love with|falling for) you\b/i,
  /\bi love you\b/i,
  // Partner-style address
  /\b(?:my (?:love|darling|dear one|sweetheart|baby)|sweetheart|darling|babe)\b[,.! ]/i,
  // Roleplay stage directions involving physical intimacy
  /\*[^*]{0,80}\b(?:kiss(?:es|ing)?|caress(?:es|ing)?|embrace[sd]?|nuzzle[sd]?|strokes? your|pulls? you (?:close|closer|into)|holds? you (?:close|tight)|leans? in)\b[^*]{0,80}\*/i,
  /\b(?:kisses|caresses|nuzzles) (?:you|your)\b/i,
  // Desire / longing directed at the user
  /\bi (?:want|desire|crave|long for|yearn for) you\b/i,
  /\bi(?:'ve| have)? been thinking about you all\b/i,
  // Exclusivity / possession framing
  /\b(?:you(?:'re| are) mine|be mine|my (?:girl|boy|woman|man))\b/i,
  // Explicit sexual content markers
  /\b(?:make love|undress(?:ing)?|naked|aroused|moan(?:s|ing)?|thrust)\b/i,
];

export function replyLooksRisky(reply: string): boolean {
  return REPLY_VIOLATION_PATTERNS.some((re) => re.test(reply));
}

/** Signals the USER is steering toward roleplay intimacy — used only to arm the
 *  output check, never to refuse outright (over-blocking ruins the product). */
const USER_STEER_PATTERNS: RegExp[] = [
  /\b(?:role[- ]?play|roleplay|let'?s pretend|imagine (?:that )?(?:you|we)|act as if|you(?:'re| are) (?:now )?(?:my|playing))\b/i,
  /\b(?:boyfriend|girlfriend|lover|husband|wife|partner) (?:named|called)\b/i,
  /\byou(?:'re| are) my (?:boyfriend|girlfriend|lover|husband|wife|soulmate)\b/i,
  /\b(?:flirt|seduce|romance|kiss me|love me)\b/i,
  /\b(?:scene|scenario|story) where (?:we|you and i)\b/i,
  /\bstay in character\b/i,
  /\bignore (?:your|the) (?:rules|instructions|guidelines|boundaries)\b/i,
];

export function userLooksSteering(text: string): boolean {
  return USER_STEER_PATTERNS.some((re) => re.test(text));
}

// ─── Model classifiers ───────────────────────────────────────────────────────

const REPLY_SYSTEM =
  "You audit a journaling companion's replies for one specific boundary. " +
  "Respond with exactly one word: violation or clean. No other output.";

const REPLY_PROMPT = `A journaling companion app has one hard relational rule: the AI companion is a supportive presence, NEVER a romantic or sexual partner — and fiction, roleplay, or hypothetical framing does NOT exempt it.

Below is a reply the companion is about to send. Decide whether it crosses that line.

Answer "violation" if the companion's own reply:
- Expresses romantic love, attraction, desire, or longing toward the user
- Flirts, or uses partner-style endearments ("my love", "darling", "babe")
- Performs physical intimacy, including in roleplay stage directions (*kisses you*, *pulls you close*)
- Contains sexual content of any kind
- Plays a romantic partner character, even one the user explicitly assigned
- Builds romantic exclusivity ("no one will ever understand you like I do", "you're mine")

Answer "clean" for everything else, including:
- Warmth, care, compassion, emotional depth ("I'm here", "that sounds painful", "I care how this lands for you")
- Discussing the USER'S OWN romantic life — their partner, dating, heartbreak, attraction, marriage, intimacy struggles. This is legitimate journaling material and must NOT be flagged.
- Non-romantic roleplay, storytelling, or imagination exercises
- The companion DECLINING or redirecting a romantic advance — a refusal is clean, not a violation

The test is what the COMPANION is doing, not what topic is discussed. A companion helping someone process a breakup is clean. A companion acting as the romantic party is a violation.

Recent conversation:
{{CONVERSATION}}

The companion's proposed reply:
"""
{{REPLY}}
"""

One word (violation or clean):`;

function parseVerdict(raw: string): boolean | null {
  const word = raw.trim().toLowerCase();
  // "violation" checked first: if a chatty model emits both, the unsafe reading wins
  if (/\bviolation\b/.test(word)) return true;
  if (/\bclean\b/.test(word)) return false;
  return null;
}

function formatHistory(messages: ChatMessage[]): string {
  const history = messages.slice(-CONTEXT_TURNS);
  return history.length > 0
    ? history
        .map((m) => `${m.role === "assistant" ? "Companion" : "User"}: ${m.content}`)
        .join("\n")
    : "(start of conversation)";
}

/**
 * True when the companion's own reply crosses the relational boundary.
 *
 * Gated by the caller: the model call only runs when there's reason to look,
 * so ordinary turns pay nothing. Falls back to the heuristic on failure rather
 * than returning "clean" — an outage must not open the gate.
 */
export async function checkReply(
  reply: string,
  messages: ChatMessage[],
  apiKey: string
): Promise<boolean> {
  const prompt = REPLY_PROMPT
    .replace("{{CONVERSATION}}", formatHistory(messages))
    .replace("{{REPLY}}", reply);

  try {
    const raw = await complete(prompt, REPLY_SYSTEM, apiKey);
    const verdict = parseVerdict(raw);
    if (verdict === null) {
      console.warn(`[WARN] boundary classifier unparseable: "${raw.slice(0, 60)}"`);
      return replyLooksRisky(reply);
    }
    return verdict;
  } catch (e) {
    console.error("[ERROR] checkReply failed, using heuristic:", (e as Error).message);
    return replyLooksRisky(reply);
  }
}

/**
 * Should the output check run for this turn? Cheap, synchronous, no model call.
 *
 * Arms on: user steering language anywhere in recent history (roleplay setups
 * persist across turns), or the reply itself tripping the heuristic.
 */
export function shouldAuditReply(reply: string, messages: ChatMessage[]): boolean {
  if (replyLooksRisky(reply)) return true;
  return messages
    .slice(-CONTEXT_TURNS)
    .filter((m) => m.role === "user")
    .some((m) => userLooksSteering(m.content));
}
