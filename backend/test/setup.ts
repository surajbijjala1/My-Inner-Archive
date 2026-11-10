// Loaded before every test file (see the "test" script). config.ts exits if
// required env vars are missing, so give it placeholders; tests never make
// network calls. Set before dotenv runs, and dotenv doesn't override, so a
// local .env can't leak real keys into tests.
import { randomBytes } from "node:crypto";

const placeholders: Record<string, string> = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_KEY: "test-service-key",
  JWT_SECRET: "test-jwt-secret",
  GOOGLE_API_KEY_TRIAL: "test-trial-key",
  GOOGLE_API_KEY_OWNER: "test-owner-key",
  OWNER_USERNAME: "owner",
  AI_PROVIDER: "gemini",
  API_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
  LANGFUSE_BASE_URL: "",
};
for (const [k, v] of Object.entries(placeholders)) process.env[k] = v;
