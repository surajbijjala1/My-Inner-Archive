import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import { scoreMood, moodLabel } from "../ai-provider.js";
import { embedText, toPgVector } from "../embeddings.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

function getMoodApiKey(username: string): string {
  if (username === config.ownerUsername) return config.googleApiKeyOwner;
  return config.googleApiKeyTrial;
}

// GET /entries — return all entries for the user
router.get("/", auth, async (req: AuthedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("entries")
      .select("*")
      .eq("username", req.user!.username)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    console.error("[ERROR] GetEntries |", (e as Error).message);
    res.status(500).json({ error: "Failed to load entries" });
  }
});

// GET /entries/:id — poll for a single entry's mood data (used by frontend scoring spinner)
router.get("/:id", auth, async (req: AuthedRequest, res) => {
  try {
    const { data } = await supabase
      .from("entries")
      .select("mood, mood_label, mood_user, mood_user_label")
      .eq("id", req.params.id)
      .eq("username", req.user!.username)
      .single();
    res.json(data || {});
  } catch (e) {
    console.error("[ERROR] GetEntryMood |", (e as Error).message);
    res.status(500).json({ error: "Failed to load entry" });
  }
});

// POST /entries — create entry, return immediately, score mood in background
router.post("/", auth, async (req: AuthedRequest, res) => {
  try {
    const { text, activity, mood_user } = req.body as {
      text?: string;
      activity?: string;
      mood_user?: number | null;
    };
    const username = req.user!.username;

    if (!text?.trim()) return res.status(400).json({ error: "text is required" });

    // Compute user mood label from lookup table (if user provided a score)
    const userScore = mood_user != null ? Math.round(Math.max(1, Math.min(10, mood_user))) : null;
    const userLabel = userScore != null ? moodLabel(userScore) : null;

    // 1. Insert the entry with the user's mood (or null if not provided)
    const { data: entry, error } = await supabase
      .from("entries")
      .insert({
        username,
        text,
        activity: activity || "🪞 Reflecting",
        mood: null,
        mood_label: null,
        mood_user: userScore,
        mood_user_label: userLabel,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // 2. Return immediately — the UI gets the entry instantly
    res.json(entry);

    // 3. Fire-and-forget: embed for retrieval in the background (best-effort —
    //    the backfill script picks up anything that fails here)
    setImmediate(async () => {
      try {
        const apiKey = getMoodApiKey(username);
        const embedding = await embedText(text, apiKey);
        if (embedding) {
          const { error: embErr } = await supabase
            .from("entries")
            .update({
              embedding: toPgVector(embedding.vector),
              embedding_model: embedding.model,
            })
            .eq("id", entry.id);
          if (embErr) console.error(`[ERROR] EmbedSave | entry=${entry.id} |`, embErr.message);
          else console.log(`[METRIC] Embed | entry=${entry.id} | model=${embedding.model}`);
        }
      } catch (e) {
        console.error(`[ERROR] Embed | entry=${entry.id} |`, (e as Error).message);
      }
    });

    // 4. Fire-and-forget: score mood in the background
    setImmediate(async () => {
      try {
        const start = performance.now();
        const apiKey = getMoodApiKey(username);
        const moodData = await scoreMood(text, apiKey);
        const elapsed = (performance.now() - start).toFixed(0);

        console.log(`[METRIC] MoodScore | user=${username} | entry=${entry.id} | provider=${config.aiProvider} | score=${moodData?.score} | latency=${elapsed}ms`);

        if (moodData) {
          // If user didn't set a mood, default mood_user to the AI score
          const finalUserScore = userScore ?? moodData.score;
          const finalUserLabel = userLabel ?? moodData.label;

          await supabase
            .from("entries")
            .update({
              mood: moodData.score,
              mood_label: moodData.label,
              mood_user: finalUserScore,
              mood_user_label: finalUserLabel,
            })
            .eq("id", entry.id);
        }
      } catch (e) {
        console.error(`[ERROR] MoodScore | entry=${entry.id} |`, (e as Error).message);
      }
    });
  } catch (e) {
    console.error("[ERROR] CreateEntry |", (e as Error).message);
    res.status(500).json({ error: "Failed to save entry" });
  }
});

// POST /entries/batch — bulk import (Feature 8): insert approved entries.
// Mood comes from the review screen (user-editable AI suggestion); embeddings
// are backfilled asynchronously; AI mood scoring is skipped (already suggested).
router.post("/batch", auth, async (req: AuthedRequest, res) => {
  try {
    const { entries } = req.body as {
      entries?: { text?: string; activity?: string; mood?: number; date?: string | null }[];
    };
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "entries array is required" });
    }
    if (entries.length > 100) {
      return res.status(400).json({ error: "Maximum 100 entries per batch" });
    }
    const username = req.user!.username;

    const rows = [];
    for (const e of entries) {
      if (!e.text?.trim()) continue;
      const score = e.mood != null ? Math.round(Math.max(1, Math.min(10, e.mood))) : null;
      rows.push({
        username,
        text: e.text.trim(),
        activity: e.activity?.trim() || "🪞 Reflecting",
        mood: score,
        mood_label: score != null ? moodLabel(score) : null,
        mood_user: score,
        mood_user_label: score != null ? moodLabel(score) : null,
        // Imported pages carry their original (possibly approximate) date
        ...(e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
          ? { created_at: new Date(`${e.date}T12:00:00Z`).toISOString() }
          : {}),
      });
    }
    if (rows.length === 0) return res.status(400).json({ error: "No valid entries in batch" });

    const { data, error } = await supabase.from("entries").insert(rows).select();
    if (error) return res.status(500).json({ error: error.message });

    console.log(`[METRIC] BatchImport | user=${username} | inserted=${data.length}`);
    res.json({ inserted: data.length, entries: data });

    // Fire-and-forget: embed the imported entries (throttled)
    setImmediate(async () => {
      const apiKey = getMoodApiKey(username);
      for (const entry of data) {
        try {
          const embedding = await embedText(entry.text, apiKey);
          if (embedding) {
            await supabase
              .from("entries")
              .update({ embedding: toPgVector(embedding.vector), embedding_model: embedding.model })
              .eq("id", entry.id);
          }
          await new Promise((r) => setTimeout(r, 4500));
        } catch (e) {
          console.error(`[ERROR] BatchEmbed | entry=${entry.id} |`, (e as Error).message);
        }
      }
    });
  } catch (e) {
    console.error("[ERROR] BatchImport |", (e as Error).message);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

// DELETE /entries/:id
router.delete("/:id", auth, async (req: AuthedRequest, res) => {
  try {
    const { error } = await supabase
      .from("entries")
      .delete()
      .eq("id", req.params.id)
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] DeleteEntry |", (e as Error).message);
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

export default router;
