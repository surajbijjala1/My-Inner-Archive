/**
 * backfill-embeddings.ts
 * Embeds every entry that (a) has no embedding yet, or (b) was embedded by a
 * different model than the currently active one. Doubles as the re-embed tool
 * when switching embedding models.
 *
 * Usage:  cd backend && npx tsx scripts/backfill-embeddings.ts
 * Safe to re-run; it only touches rows that need work. Rate-limited for the
 * Gemini free tier; Ollama runs as fast as the local machine allows.
 */

import { config } from "../src/config.js";
import { supabase } from "../src/lib/supabase.js";
import { embedText, toPgVector } from "../src/embeddings.js";

const GEMINI_DELAY_MS = 4500; // ~13 RPM, under the 15 RPM free-tier limit
const OLLAMA_DELAY_MS = 100;

const activeModel =
  config.aiProvider === "ollama" ? config.ollamaEmbeddingModel : config.geminiEmbeddingModel;

async function main() {
  console.log(`Active provider: ${config.aiProvider} | target model: ${activeModel}`);

  const { data: rows, error } = await supabase
    .from("entries")
    .select("id, username, text, embedding_model")
    .or(`embedding.is.null,embedding_model.neq.${activeModel}`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to list entries:", error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("Nothing to backfill — all entries are embedded with the active model.");
    return;
  }

  console.log(`${rows.length} entries to embed...`);
  let ok = 0;
  let failed = 0;

  for (const [i, row] of rows.entries()) {
    // Owner key for the owner's entries, trial key otherwise (matches mood scoring)
    const apiKey =
      row.username === config.ownerUsername ? config.googleApiKeyOwner : config.googleApiKeyTrial;

    const result = await embedText(row.text, apiKey);
    if (result) {
      const { error: upErr } = await supabase
        .from("entries")
        .update({ embedding: toPgVector(result.vector), embedding_model: result.model })
        .eq("id", row.id);
      if (upErr) {
        failed++;
        console.error(`  [${i + 1}/${rows.length}] ${row.id} save failed: ${upErr.message}`);
      } else {
        ok++;
        console.log(`  [${i + 1}/${rows.length}] ${row.id} ok (${result.model})`);
      }
      // Rate-limit based on which provider actually served the embedding
      const delay = result.model === config.geminiEmbeddingModel ? GEMINI_DELAY_MS : OLLAMA_DELAY_MS;
      await new Promise((r) => setTimeout(r, delay));
    } else {
      failed++;
      console.error(`  [${i + 1}/${rows.length}] ${row.id} embed failed (all providers)`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone. embedded=${ok} failed=${failed}`);
  if (failed > 0) console.log("Re-run this script to retry the failures.");
}

main();
