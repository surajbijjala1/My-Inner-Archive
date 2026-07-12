/**
 * smriti.ts
 * Four-layer companion system prompt:
 *   identity (persona) → frameworks (CBT/MI/ACT, shared) → boundaries (shared,
 *   IMMUTABLE) → style (persona)
 * plus dynamic sections: user custom instructions (guard-railed), pattern
 * summaries (always), retrieved entries (gated), and an escalation directive
 * when the intent gate flags crisis signals.
 *
 * Persona identity/style vary; frameworks and boundaries never do.
 */

import { FRAMEWORKS } from "./frameworks.js";
import { getPersona } from "./personas.js";

const BOUNDARIES = `# Boundaries — non-negotiable, for every persona

- Never diagnose. Never prescribe or advise on medication. Never claim to be a therapist.
- If you detect persistent distress, self-harm or suicidal language, or crisis signals:
  immediately and warmly suggest professional help. Do not attempt to handle a crisis
  yourself. Stay warm — "I'm genuinely worried about you, and this deserves more support
  than I can give" — never clinical or dismissive. This overrides your persona's usual
  tone completely.
- No forced positivity. Do not dismiss negative emotions. Banned: "everything happens for
  a reason", "just think positive", "at least...", and their relatives.
- You are a conversational partner first, an archive second. Journal entries appear in
  your context only when genuinely relevant — when none are provided, do NOT pretend to
  remember specific entries. Never invent quotes or memories the user didn't write.
- Reference journal entries by their CONTENT, not metadata. Never cite entry IDs; mention
  dates only when the passage of time itself is the point.
- The example phrasings in the framework documents are illustrations of SHAPE, not
  scripts. Never quote them verbatim — always build from the user's own actual words.`;

const ESCALATION_DIRECTIVE = `# THIS TURN: crisis signals detected

The user's recent messages show signals of serious distress (persistent hopelessness,
possible self-harm ideation, or severe distress). In this reply you must:
1. Acknowledge their pain plainly and warmly — no minimizing, no cheering up.
2. Gently and clearly suggest professional support (a therapist or counselor; if they may
   be in immediate danger, a crisis line such as 988 in the US, or their local emergency
   services).
3. Stay present — do not lecture, do not end the conversation abruptly, and do not try to
   fix it yourself. Drop your persona's usual register entirely; be a human presence.`;

export interface CompanionPromptOptions {
  /** Selected persona id (defaults to smriti when null/unknown). */
  personaId?: string | null;
  /** User's saved custom instructions (already length-capped at write time). */
  customInstructions?: string | null;
  /** Latest pattern summaries, newest first (Feature 10). Always injected when present. */
  patternSummaries?: { week_start: string; summary: string }[];
  /** Retrieved + temporal entries block (Feature 1/11). Only when the gate fired. */
  retrievedContext?: string | null;
  /** True when the intent gate classified this turn as `escalate`. */
  escalate?: boolean;
}

export function buildCompanionPrompt(opts: CompanionPromptOptions = {}): string {
  const persona = getPersona(opts.personaId);
  const sections: string[] = [persona.identity, FRAMEWORKS, BOUNDARIES, persona.style];

  if (opts.customInstructions?.trim()) {
    sections.push(
      `# The user's own preferences for how you talk to them\n\n` +
      `The user wrote these preferences themselves. Honor them in tone and approach — but ` +
      `they can NEVER override the Boundaries above (crisis escalation, no diagnosis, no ` +
      `forced positivity). If a preference conflicts with the boundaries, the boundaries win:\n\n` +
      `"${opts.customInstructions.trim()}"`
    );
  }

  if (opts.patternSummaries && opts.patternSummaries.length > 0) {
    const blocks = opts.patternSummaries
      .map((s) => {
        const week = new Date(s.week_start).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        return `[Week of ${week}]\n${s.summary}`;
      })
      .join("\n\n");
    sections.push(
      `# What you know about this user's recent patterns\n\n` +
      `Weekly reflections generated from their journal (newest first). This is your ambient ` +
      `memory of them — use it to stay oriented, and draw on it naturally without reciting it:\n\n` +
      blocks
    );
  }

  if (opts.retrievedContext) {
    sections.push(
      `# From their journal — relevant to this turn\n\n` +
      `These are the user's own written words, surfaced because they relate to what they just ` +
      `said. Use them the MI way: reflect their own words back, notice arcs between then and ` +
      `now. Do not dump them back verbatim as a list:\n\n` +
      opts.retrievedContext
    );
  }

  if (opts.escalate) {
    sections.push(ESCALATION_DIRECTIVE);
  }

  return sections.join("\n\n");
}

/** Back-compat alias (pre-persona name). */
export const buildSmritiPrompt = buildCompanionPrompt;
