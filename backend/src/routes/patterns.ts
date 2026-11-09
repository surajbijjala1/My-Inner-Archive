import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { auth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

/** The patterns screen draws roughly six months of days at a time. */
const DEFAULT_WINDOW_DAYS = 182;
/** Every tag you have used, but the screen only draws the ones that recur. */
const MIN_TAG_USES = 1;

type EntryRow = {
  created_at: string;
  activity: string | null;
  mood: number | null;
  mood_user: number | null;
};

/** Local calendar day in ISO form, so a day groups the way you lived it. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Tags are stored with an emoji prefix; the screen counts the words. */
function tagWord(activity: string): string {
  return activity.replace(/^\s*\P{L}+\s*/u, "").trim() || activity.trim();
}

/**
 * GET /patterns — everything the patterns screen draws, in one read:
 * how often you wrote, how you felt, what you have written from, and the
 * weekly reflections already stored for you.
 *
 * `tone` is part of the response shape but is always null for now: "how you
 * sounded" is a designed-but-deferred layer, and shipping the key here means
 * the screen can start drawing it without another contract change.
 */
router.get("/", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;

    const days = Math.min(
      Math.max(parseInt(String(req.query.days ?? ""), 10) || DEFAULT_WINDOW_DAYS, 1),
      366 * 5
    );
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [entriesResult, summariesResult] = await Promise.all([
      supabase
        .from("entries")
        .select("created_at, activity, mood, mood_user")
        .eq("username", username)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true }),
      supabase
        .from("pattern_summaries")
        .select("week_start, summary, created_at")
        .eq("username", username)
        .order("week_start", { ascending: false })
        .limit(4),
    ]);

    if (entriesResult.error) {
      return res.status(500).json({ error: entriesResult.error.message });
    }

    const entries = (entriesResult.data ?? []) as EntryRow[];

    // How often you wrote — one cell per day that has anything in it.
    const counts = new Map<string, number>();
    // How you felt — your own score when you gave one, the read one otherwise.
    const mood: { date: string; score: number; own: boolean }[] = [];
    // Where you write from.
    const tags = new Map<string, number>();

    for (const entry of entries) {
      const day = dayOf(entry.created_at);
      counts.set(day, (counts.get(day) ?? 0) + 1);

      const score = entry.mood_user ?? entry.mood;
      if (score != null) {
        mood.push({ date: day, score, own: entry.mood_user != null });
      }

      if (entry.activity) {
        const word = tagWord(entry.activity);
        if (word) tags.set(word, (tags.get(word) ?? 0) + 1);
      }
    }

    // A summary read failure is not worth failing the whole screen for — the
    // prose is the one part of this page that is allowed to be absent.
    const summaries = summariesResult.error
      ? []
      : (summariesResult.data ?? []).map((row) => ({
          weekStart: row.week_start,
          summary: row.summary,
          writtenAt: row.created_at,
        }));

    res.json({
      windowDays: days,
      heatmap: [...counts.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      mood,
      tags: [...tags.entries()]
        .filter(([, count]) => count >= MIN_TAG_USES)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      summaries,
      tone: null,
    });
  } catch (e) {
    console.error("[ERROR] GetPatterns |", (e as Error).message);
    res.status(500).json({ error: "Failed to load patterns" });
  }
});

export default router;
