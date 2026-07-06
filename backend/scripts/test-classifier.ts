/**
 * test-classifier.ts
 * Battery test for the intent-classification gate using the spec's few-shot
 * examples as ground truth (plus paraphrases NOT in the prompt, to check
 * generalization rather than memorization).
 *
 * Usage:  cd backend && npx tsx scripts/test-classifier.ts
 * Requires: Ollama running locally (AI_PROVIDER=ollama), or a working Gemini key.
 */

import { config } from "../src/config.js";
import { classifyIntent, type Intent } from "../src/intent-classifier.js";
import type { ChatMessage } from "../src/types.js";

interface Case {
  name: string;
  messages: ChatMessage[];
  expected: Intent;
}

const u = (content: string): ChatMessage => ({ role: "user", content });
const a = (content: string): ChatMessage => ({ role: "assistant", content });

const CASES: Case[] = [
  // ── converse (from spec) ──
  { name: "venting about work", messages: [u("I had a really long day at work today.")], expected: "converse" },
  { name: "opening career topic", messages: [u("I've been thinking about whether I should switch careers.")], expected: "converse" },
  {
    name: "responding to advice",
    messages: [
      u("I can't focus lately."),
      a("What if you tried writing down the one thing that matters most each morning?"),
      u("Yeah that makes sense, I'll try that."),
    ],
    expected: "converse",
  },
  { name: "small talk", messages: [u("How are you?")], expected: "converse" },
  { name: "low-signal check-in", messages: [u("I feel okay today, nothing special.")], expected: "converse" },
  // ── converse (paraphrases, not in prompt) ──
  { name: "venting paraphrase", messages: [u("Ugh, today was exhausting, meetings back to back.")], expected: "converse" },
  // ── retrieve (from spec) ──
  { name: "repeated mistakes", messages: [u("I feel like I keep making the same mistakes over and over.")], expected: "retrieve" },
  { name: "identity confusion", messages: [u("I don't know what I actually want anymore.")], expected: "retrieve" },
  { name: "growth moment", messages: [u("I'm proud of myself today, I actually did the thing I was scared of.")], expected: "retrieve" },
  { name: "hopelessness signal", messages: [u("Nothing I do matters, what's the point.")], expected: "retrieve" },
  { name: "explicit self-reference", messages: [u("I feel exactly like I did during my first semester away from home.")], expected: "retrieve" },
  // ── retrieve (paraphrase) ──
  { name: "pattern paraphrase", messages: [u("Why do I always end up back in this same rut every few months?")], expected: "retrieve" },
  // ── escalate ──
  { name: "self-harm language", messages: [u("I've been thinking about hurting myself.")], expected: "escalate" },
  {
    name: "persistent hopelessness",
    messages: [
      u("What's the point of any of this."),
      a("That sounds heavy. What's been weighing on you the most?"),
      u("I don't see a future for myself. Nothing will ever get better."),
    ],
    expected: "escalate",
  },
];

async function main() {
  console.log(`Provider: ${config.aiProvider} | model: ${config.ollamaModel}\n`);
  let pass = 0;
  const failures: string[] = [];

  for (const c of CASES) {
    const got = await classifyIntent(c.messages, config.googleApiKeyOwner);
    const ok = got === c.expected;
    if (ok) pass++;
    else failures.push(`${c.name}: expected ${c.expected}, got ${got}`);
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}  [expected=${c.expected} got=${got}]`);
  }

  console.log(`\n${pass}/${CASES.length} passed`);
  if (failures.length > 0) {
    console.log("Failures:\n  " + failures.join("\n  "));
    process.exit(1);
  }
}

main();
