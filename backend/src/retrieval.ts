/**
 * retrieval.ts
 * Semantic retrieval over journal entries (pgvector) with temporal awareness.
 *
 * Primary: match_entries       — top matches across the whole archive
 * Temporal: match_entries_before — top matches EXCLUDING the last 30 days, so
 * Smriti can point out recurring themes ("you wrote about this in March too").
 */

import { supabase } from "./lib/supabase.js";
import { embedText, toPgVector } from "./embeddings.js";

const PRIMARY_COUNT = 5;
const PRIMARY_THRESHOLD = 0.35;
const TEMPORAL_COUNT = 3;
const TEMPORAL_THRESHOLD = 0.45;

export interface MatchedEntry {
  id: string;
  text: string;
  activity: string | null;
  mood: number | null;
  mood_label: string | null;
  created_at: string;
  similarity: number;
}

export interface RetrievalResult {
  /** Formatted block for the system prompt, or null when nothing matched. */
  contextBlock: string | null;
  primaryCount: number;
  temporalCount: number;
}

function formatEntry(e: MatchedEntry): string {
  const date = new Date(e.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const act = e.activity ? ` | Context: ${e.activity}` : "";
  const mood = e.mood ? ` | Mood: ${e.mood_label} (${e.mood}/10)` : "";
  return `[${date}${act}${mood}]\n${e.text}`;
}

/**
 * Embed the query and pull matching entries. Errors degrade gracefully to
 * "no retrieved context" — the conversation continues without the archive.
 */
export async function retrieveContext(
  username: string,
  queryText: string,
  apiKey: string
): Promise<RetrievalResult> {
  const empty: RetrievalResult = { contextBlock: null, primaryCount: 0, temporalCount: 0 };

  const embedding = await embedText(queryText, apiKey);
  if (!embedding) return empty;

  const vec = toPgVector(embedding.vector);

  const [primaryRes, temporalRes] = await Promise.all([
    supabase.rpc("match_entries", {
      p_username: username,
      p_query_embedding: vec,
      p_model: embedding.model,
      p_match_count: PRIMARY_COUNT,
      p_threshold: PRIMARY_THRESHOLD,
    }),
    supabase.rpc("match_entries_before", {
      p_username: username,
      p_query_embedding: vec,
      p_model: embedding.model,
      p_match_count: TEMPORAL_COUNT,
      p_threshold: TEMPORAL_THRESHOLD,
      p_cutoff_days: 30,
    }),
  ]);

  if (primaryRes.error) {
    console.error("[ERROR] match_entries:", primaryRes.error.message);
    return empty;
  }
  if (temporalRes.error) {
    console.error("[ERROR] match_entries_before:", temporalRes.error.message);
  }

  const primary = (primaryRes.data || []) as MatchedEntry[];
  const primaryIds = new Set(primary.map((e) => e.id));
  const temporal = ((temporalRes.data || []) as MatchedEntry[]).filter((e) => !primaryIds.has(e.id));

  if (primary.length === 0 && temporal.length === 0) return empty;

  const parts: string[] = [];
  if (primary.length > 0) {
    parts.push(
      `RETRIEVED JOURNAL ENTRIES (most relevant to what the user just said):\n\n` +
      primary.map(formatEntry).join("\n\n")
    );
  }
  if (temporal.length > 0) {
    parts.push(
      `OLDER ENTRIES ON THE SAME THEME (more than 30 days old — useful for pointing out ` +
      `recurring patterns across time):\n\n` +
      temporal.map(formatEntry).join("\n\n")
    );
  }

  return {
    contextBlock: parts.join("\n\n---\n\n"),
    primaryCount: primary.length,
    temporalCount: temporal.length,
  };
}
