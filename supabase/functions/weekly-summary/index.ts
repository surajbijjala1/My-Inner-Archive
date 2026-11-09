// weekly-summary — Supabase Edge Function (Deno)
// Triggered weekly by pg_cron (see supabase/migrations/0002_cron.sql).
//
// For each user with entries in the past 4 weeks:
//   1. Pull those entries (+ the previous weekly summary for continuity)
//   2. Ask Gemini for a 300-500 word structured pattern summary
//   3. Insert into pattern_summaries; keep only the newest 4 rows per user
//
// Background-job fallback policy (pre-approved): Gemini-only, retry with
// exponential backoff inside the run; on total failure keep the previous
// summary (skip the user) and let next week's cron retry.
//
// Required secrets (supabase secrets set ...):
//   GEMINI_API_KEY — Gemini API key for summary generation
//   CRON_SECRET    — shared with pg_cron via Vault (see 0009); requests without it are refused
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import { rejectUnlessCron } from "../_shared/cron-auth.ts";

// 3.1-flash-lite: 500 RPD free tier vs 20 on 2.5-flash — avoids Sunday
// collisions with the tiny chat-model buckets.
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_ATTEMPTS = 3;
/** Per-attempt deadline; there was none, so one hung call could eat the run. */
const ATTEMPT_TIMEOUT_MS = 90_000;
/** Longest Gemini-requested wait we'll sit through (users run sequentially
 *  inside a 300s cron budget). */
const MAX_RETRY_WAIT_MS = 30_000;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface EntryRow {
  text: string;
  activity: string | null;
  mood: number | null;
  mood_label: string | null;
  created_at: string;
}

/** A failure worth retrying: rate limits, server errors, timeouts, network. */
class TransientError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

/** Gemini sends its retry hint in the error body, not a Retry-After header:
 *  "Please retry in 28.4s" or "retryDelay": "28s". */
function retryHintMs(body: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(body);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

async function geminiComplete(prompt: string, apiKey: string): Promise<string> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
          },
        );
      } catch (e) {
        throw new TransientError(`network/timeout: ${(e as Error).message}`);
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        const msg = `Gemini HTTP ${res.status}: ${body.slice(0, 200)}`;
        // 400/401/403/404 won't succeed on replay — a bad key or prompt just
        // burns the remaining attempts (and the cron's time budget).
        if (res.status === 429 || res.status === 408 || res.status >= 500) {
          throw new TransientError(msg, retryHintMs(body));
        }
        throw new Error(msg);
      }
      const data = await res.json();
      const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text?.trim()) throw new TransientError("empty completion");
      return text.trim();
    } catch (e) {
      lastError = (e as Error).message;
      if (!(e instanceof TransientError)) throw e;
      console.warn(`Gemini attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`);
      if (attempt === MAX_ATTEMPTS) break;
      // Honour Gemini's hint up to a cap; otherwise exponential with full jitter.
      const hinted = e.retryAfterMs;
      if (hinted !== undefined && hinted > MAX_RETRY_WAIT_MS) break;
      const delay = hinted ?? Math.random() * 2000 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`Gemini failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

/** Monday (UTC) of the current week, as YYYY-MM-DD. The summary is labelled
 *  "Week of …" in the companion's prompt, so this must be the week, not the
 *  run date; it also makes a re-run in the same week update one row instead
 *  of adding another. */
function currentWeekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

function buildPrompt(entries: EntryRow[], previousSummary: string | null): string {
  const formatted = entries
    .map((e) => {
      const date = new Date(e.created_at).toISOString().slice(0, 10);
      const act = e.activity ? ` | ${e.activity}` : "";
      const mood = e.mood ? ` | mood ${e.mood_label} (${e.mood}/10)` : "";
      return `[${date}${act}${mood}]\n${e.text}`;
    })
    .join("\n\n");

  const continuity = previousSummary
    ? `\n\nFor continuity, here is last week's summary — build on it, noting what has ` +
      `evolved, resolved, or persisted:\n${previousSummary}`
    : "";

  return (
    `Analyze these journal entries from the past month. Identify:\n` +
    `(1) recurring emotional themes,\n` +
    `(2) evolving perspectives or growth areas,\n` +
    `(3) unresolved tensions or repeated frustrations,\n` +
    `(4) positive patterns the user may not notice.\n\n` +
    `Output a structured summary of 300-500 words. Write in second person ("you") about ` +
    `the journal author. Be specific — reference actual themes and phrasings from the ` +
    `entries, not generic observations.${continuity}\n\n` +
    `JOURNAL ENTRIES (oldest first):\n\n${formatted}`
  );
}

Deno.serve(async (req) => {
  const rejected = rejectUnlessCron(req);
  if (rejected) return rejected;

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY secret not set" }), { status: 500 });
  }

  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 3600 * 1000).toISOString();
  const weekStart = currentWeekStart();

  // Users with recent entries. Paged: PostgREST silently caps a response at
  // 1000 rows, so a single read would skip users once the window holds more
  // than 1000 entries across everyone.
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: usersErr } = await supabase
      .from("entries")
      .select("username")
      .gte("created_at", fourWeeksAgo)
      .order("id")
      .range(from, from + PAGE - 1);
    if (usersErr) {
      return new Response(JSON.stringify({ error: usersErr.message }), { status: 500 });
    }
    for (const r of page ?? []) seen.add((r as { username: string }).username);
    if (!page || page.length < PAGE) break;
  }
  const usernames = [...seen];
  const results: Record<string, string> = {};

  for (const username of usernames) {
    try {
      const { data: entries } = await supabase
        .from("entries")
        .select("text, activity, mood, mood_label, created_at")
        .eq("username", username)
        .gte("created_at", fourWeeksAgo)
        .order("created_at", { ascending: true });

      if (!entries || entries.length === 0) {
        results[username] = "skipped: no entries";
        continue;
      }

      const { data: prev } = await supabase
        .from("pattern_summaries")
        .select("summary")
        .eq("username", username)
        .order("week_start", { ascending: false })
        .limit(1);

      const summary = await geminiComplete(
        buildPrompt(entries as EntryRow[], prev?.[0]?.summary ?? null),
        apiKey,
      );

      const { error: insertErr } = await supabase
        .from("pattern_summaries")
        .upsert(
          { username, week_start: weekStart, summary },
          { onConflict: "username,week_start" },
        );
      if (insertErr) throw new Error(insertErr.message);

      // Keep only the newest 4 summaries per user
      const { data: all } = await supabase
        .from("pattern_summaries")
        .select("id")
        .eq("username", username)
        .order("week_start", { ascending: false });

      const stale = (all || []).slice(4).map((r: { id: string }) => r.id);
      if (stale.length > 0) {
        await supabase.from("pattern_summaries").delete().in("id", stale);
      }

      results[username] = "ok";
    } catch (e) {
      // Keep previous summary; next weekly tick retries
      console.error(`weekly-summary failed for ${username}:`, (e as Error).message);
      results[username] = `failed: ${(e as Error).message}`;
    }
  }

  return new Response(JSON.stringify({ processed: usernames.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
