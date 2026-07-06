/**
 * embeddings.ts
 * Provider-aware text embeddings, mirroring the ai-provider fallback pattern:
 * Ollama (nomic-embed-text) primary when AI_PROVIDER=ollama, Gemini
 * (gemini-embedding-001 @ 768 dims) otherwise / as fallback.
 *
 * IMPORTANT: vectors from different models live in different spaces and are
 * NOT comparable. Every stored embedding records its model, and retrieval only
 * matches entries embedded by the model that embedded the query.
 */

import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

export interface EmbeddingResult {
  vector: number[];
  /** Model that produced the vector — stored alongside it and used to scope retrieval. */
  model: string;
}

/** L2-normalize so cosine similarity behaves consistently across models.
 *  (gemini-embedding-001 vectors are only pre-normalized at 3072 dims.) */
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

async function ollamaEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${config.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ollamaEmbeddingModel, input: text }),
    // Generous: the first call after idle pays the model cold-load (~15s+)
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  const vector = data.embeddings?.[0];
  if (!vector || vector.length !== config.embeddingDimensions) {
    throw new Error(`Ollama embed returned ${vector?.length ?? 0} dims, expected ${config.embeddingDimensions}`);
  }
  return vector;
}

async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.embedContent({
    model: config.geminiEmbeddingModel,
    contents: text,
    config: { outputDimensionality: config.embeddingDimensions },
  });
  const vector = res.embeddings?.[0]?.values;
  if (!vector || vector.length !== config.embeddingDimensions) {
    throw new Error(`Gemini embed returned ${vector?.length ?? 0} dims, expected ${config.embeddingDimensions}`);
  }
  return vector;
}

/**
 * Embed a text. Returns null on total failure (callers treat embedding as
 * best-effort: entries without embeddings are simply invisible to retrieval
 * until the backfill script picks them up).
 */
export async function embedText(text: string, apiKey: string): Promise<EmbeddingResult | null> {
  if (config.aiProvider === "ollama") {
    try {
      const vector = await ollamaEmbed(text);
      return { vector: normalize(vector), model: config.ollamaEmbeddingModel };
    } catch (e) {
      console.warn("⚠️  Ollama embed failed, falling back to Gemini:", (e as Error).message);
    }
  }
  try {
    const vector = await geminiEmbed(text, apiKey);
    return { vector: normalize(vector), model: config.geminiEmbeddingModel };
  } catch (e) {
    console.error("[ERROR] embedText failed on all providers:", (e as Error).message);
    return null;
  }
}

/** Serialize a vector for pgvector via PostgREST. */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
