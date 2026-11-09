/**
 * config.ts
 * Central env-var validation and typed configuration.
 * Fails fast at startup with a clear message if anything required is missing.
 * All model names live here so swapping a model is a one-line change.
 */

import "dotenv/config";

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "JWT_SECRET",
  "GOOGLE_API_KEY_TRIAL",
  "GOOGLE_API_KEY_OWNER",
  "OWNER_USERNAME",
] as const;

const missing = REQUIRED_VARS.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(
    `FATAL: missing required environment variable(s): ${missing.join(", ")}\n` +
    `Set them in backend/.env (local) or the Render dashboard (production).`
  );
  process.exit(1);
}

/** 32-byte key for at-rest encryption of users' API keys, given as base64 or
 *  hex. Optional — without it, saving a user key is refused — but if it IS set
 *  and malformed, fail at startup rather than at the first save. */
function parseEncryptionKey(raw: string | undefined): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (buf.length !== 32) {
    console.error("FATAL: API_KEY_ENCRYPTION_KEY must decode to 32 bytes (e.g. `openssl rand -base64 32`)");
    process.exit(1);
  }
  return buf;
}

const aiProvider = process.env.AI_PROVIDER === "ollama" ? "ollama" : "gemini";

export const config = {
  // Server
  port: parseInt(process.env.PORT || "", 10) || 3001,
  /** Production frontend origin for CORS (e.g. the Vercel domain). Optional in dev. */
  frontendOrigin: process.env.FRONTEND_ORIGIN?.trim() || null,

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,

  // Auth
  jwtSecret: process.env.JWT_SECRET!,

  // AI provider selection
  aiProvider,
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.2",
  /** Chat model (Smriti + search_journal tool). 3.1-flash-lite: 500 RPD / 15 RPM
   *  free tier on this project — vs 20 RPD on the 2.5/3.x Flash tiers. */
  geminiModel: "gemini-3.1-flash-lite",
  /** Utility model for mood scoring / intent classification. Shares the chat
   *  model's 500 RPD pool; kept as a separate key so it can diverge again. */
  geminiUtilityModel: "gemini-3.1-flash-lite",
  /** Vision model for OCR — rare, owner-gated usage where extraction quality
   *  matters more than quota (20 RPD is plenty; tesseract.js is the fallback). */
  geminiVisionModel: "gemini-2.5-flash",

  /** Ordered fallback chain for chat when the primary Gemini model fails.
   *  Kept explicit so a quota-exhausted or overloaded model degrades to a
   *  working one instead of 500-ing the conversation. */
  geminiChatFallbacks: ["gemini-2.5-flash"] as string[],

  // Deadlines (ms). Gemini calls previously had NONE — a hung connection held
  // an Express worker until the socket died.
  timeouts: {
    geminiChat: 45_000,
    geminiUtility: 20_000,
    geminiEmbed: 30_000,
    geminiVision: 60_000,
    ollamaChat: 60_000,
    ollamaComplete: 30_000,
    ollamaEmbed: 45_000,
    ollamaProbe: 1_500,
  },

  /** Cached liveness-probe TTL — the probe used to run on every chat turn. */
  ollamaProbeTtlMs: 15_000,

  /** OTLP trace endpoint. Accepts either the generic OTel variable or Langfuse's
   *  own LANGFUSE_BASE_URL (what their dashboard hands you), deriving the
   *  /api/public/otel path from the latter. Unset = tracing disabled, so local
   *  dev and existing deploys are unaffected. */
  otelEndpoint: (() => {
    const explicit = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    if (explicit) return explicit.replace(/\/$/, "");
    const langfuse = process.env.LANGFUSE_BASE_URL?.trim();
    if (langfuse) return `${langfuse.replace(/\/$/, "")}/api/public/otel`;
    return null;
  })(),
  /** Langfuse authenticates OTLP with Basic auth over its public/secret keys. */
  otelHeaders: (() => {
    const pk = process.env.LANGFUSE_PUBLIC_KEY?.trim();
    const sk = process.env.LANGFUSE_SECRET_KEY?.trim();
    if (pk && sk) {
      return { Authorization: `Basic ${Buffer.from(`${pk}:${sk}`).toString("base64")}` };
    }
    return {} as Record<string, string>;
  })(),

  /** Last-resort reply when every provider in the chain fails. */
  chatFallbackReply:
    "I'm having trouble reaching my thoughts right now — something on my end, not you. " +
    "Give it a moment and try again. What you wrote is safe.",

  // Embedding models (Phase 1) — 768 dims on both paths so vectors share one column
  geminiEmbeddingModel: "gemini-embedding-001",
  ollamaEmbeddingModel: "nomic-embed-text",
  embeddingDimensions: 768,

  // API keys & limits
  /** At-rest encryption key for users' stored Gemini keys (lib/secret-box.ts). */
  apiKeyEncryptionKey: parseEncryptionKey(process.env.API_KEY_ENCRYPTION_KEY),
  googleApiKeyTrial: process.env.GOOGLE_API_KEY_TRIAL!,
  googleApiKeyOwner: process.env.GOOGLE_API_KEY_OWNER!,
  ownerUsername: process.env.OWNER_USERNAME!,
  freeMessageLimit: parseInt(process.env.FREE_MESSAGE_LIMIT || "", 10) || 10,

  // TTS (Phase 4 voice chat) — Edge neural voices via msedge-tts, one per
  // persona. Client falls back to browser SpeechSynthesis if this endpoint
  // fails. Swapping a voice is a one-line change here.
  ttsVoiceDefault: "en-US-AvaMultilingualNeural",
  ttsVoices: {
    // The two "Multilingual" voices are Edge's newest and most natural-sounding
    // generation. The free Edge list has no natural-sounding en-IN voices
    // (Neerja sounds robotic), so all personas use US voices for now.
    smriti: "en-US-AvaMultilingualNeural", //  warm, reflective
    mitra: "en-US-EmmaMultilingualNeural", //  bright, friendly
    drishti: "en-US-AriaNeural", //            crisp, direct
    sakhi: "en-US-MichelleNeural", //          soft, unhurried
  } as Record<string, string>,
  /** Longest reply we'll synthesize in one request. */
  ttsMaxChars: 3000,
} as const;

export type AiProvider = typeof config.aiProvider;
