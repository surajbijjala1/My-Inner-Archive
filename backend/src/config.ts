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

  // Embedding models (Phase 1) — 768 dims on both paths so vectors share one column
  geminiEmbeddingModel: "gemini-embedding-001",
  ollamaEmbeddingModel: "nomic-embed-text",
  embeddingDimensions: 768,

  // API keys & limits
  googleApiKeyTrial: process.env.GOOGLE_API_KEY_TRIAL!,
  googleApiKeyOwner: process.env.GOOGLE_API_KEY_OWNER!,
  ownerUsername: process.env.OWNER_USERNAME!,
  freeMessageLimit: parseInt(process.env.FREE_MESSAGE_LIMIT || "", 10) || 10,

  // TTS (Phase 4 voice chat) — Edge neural voices via msedge-tts, one per
  // persona. Client falls back to browser SpeechSynthesis if this endpoint
  // fails. Swapping a voice is a one-line change here.
  ttsVoiceDefault: "en-IN-NeerjaNeural",
  ttsVoices: {
    smriti: "en-IN-NeerjaNeural", //          calm, reflective
    mitra: "en-IN-NeerjaExpressiveNeural", // warm, animated
    drishti: "en-US-AriaNeural", //           crisp, direct
    sakhi: "en-US-MichelleNeural", //         soft, unhurried
  } as Record<string, string>,
  /** Longest reply we'll synthesize in one request. */
  ttsMaxChars: 3000,
} as const;

export type AiProvider = typeof config.aiProvider;
