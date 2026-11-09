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
import {
  geminiBreaker,
  UpstreamError,
  parseRetryAfterHeader,
  withRetry,
  withTimeout,
} from "./lib/resilience.js";
import { withLlmSpan } from "./lib/telemetry.js";

// One client per key — see the same note in ai-provider.ts
const clients = new Map<string, GoogleGenAI>();
function geminiClient(apiKey: string): GoogleGenAI {
  let client = clients.get(apiKey);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clients.set(apiKey, client);
  }
  return client;
}

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
    signal: AbortSignal.timeout(config.timeouts.ollamaEmbed),
  });
  if (!res.ok) {
    throw new UpstreamError(`Ollama embed error: ${res.status}`, res.status, parseRetryAfterHeader(res));
  }
  const data = (await res.json()) as { embeddings: number[][] };
  const vector = data.embeddings?.[0];
  if (!vector || vector.length !== config.embeddingDimensions) {
    throw new Error(`Ollama embed returned ${vector?.length ?? 0} dims, expected ${config.embeddingDimensions}`);
  }
  return vector;
}

async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const res = await withLlmSpan(
    { operation: "embed", model: config.geminiEmbeddingModel },
    async (record) => {
      const response = await withTimeout(config.timeouts.geminiEmbed, async (abortSignal) =>
        geminiClient(apiKey).models.embedContent({
          model: config.geminiEmbeddingModel,
          contents: text,
          config: { outputDimensionality: config.embeddingDimensions, abortSignal },
        })
      );
      // Embedding responses report only input tokens
      record({ inputTokens: (response as { usageMetadata?: { promptTokenCount?: number } })?.usageMetadata?.promptTokenCount });
      return response;
    }
  );
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
/** How long a background caller will sit out a quota window. User-facing
 *  callers (retrieval) keep withRetry's default cap and fail fast instead. */
export const BACKGROUND_EMBED_WAIT_MS = 120_000;

export async function embedText(
  text: string,
  apiKey: string,
  { maxWaitMs }: { maxWaitMs?: number } = {}
): Promise<EmbeddingResult | null> {
  if (config.aiProvider === "ollama") {
    try {
      const vector = await withRetry(() => ollamaEmbed(text), { label: "ollama.embed", attempts: 2 });
      return { vector: normalize(vector), model: config.ollamaEmbeddingModel };
    } catch (e) {
      console.warn("⚠️  Ollama embed failed, falling back to Gemini:", (e as Error).message);
    }
  }
  try {
    // Retry matters more here than anywhere: a dropped embedding leaves the
    // entry invisible to retrieval until someone runs the backfill script.
    const vector = await geminiBreaker(apiKey, config.geminiEmbeddingModel).run(() =>
      withRetry(() => geminiEmbed(text, apiKey), { label: "gemini.embed", maxDelayMs: maxWaitMs })
    );
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
