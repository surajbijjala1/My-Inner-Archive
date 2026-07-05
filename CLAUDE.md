# My Inner Archive

Private AI journaling app. React 19 + Vite SPA (`frontend/`, TypeScript), Express 5 API
(`backend/`, TypeScript + ESM), Supabase PostgreSQL (pgvector + pg_cron enabled).
Deployment: frontend = Vercel (auto-deploy on push), backend = Render, cron = Supabase
pg_cron → Edge Functions (Deno). Firebase is ONLY for FCM push + App Distribution — never
hosting/DB.

## Critical rules
- NO assumptions: unsure about schema, patterns, versions, integrations → ASK first.
- Flag contradictions between instructions and actual code; never silently adapt.
- Production quality: error handling, edge cases, loading states, fallbacks, type safety,
  mobile responsiveness are mandatory.
- EVERY Gemini-dependent USER-FACING real-time path MUST have a fallback (Gemini is
  unreliable). Background/cron jobs are Gemini-only: retry with exponential backoff,
  keep previous result on failure (summaries), or skip the slot and retry next tick
  (notifications).
- Ask before deleting or significantly refactoring working code.
- Match the conventions below (post-TypeScript-migration patterns, not the old JS ones).

## Stack & conventions
- TypeScript everywhere; backend is ESM ("type": "module"). Real type annotations — no
  JSDoc-typing.
- Frontend: function components + hooks, state lifted to App.tsx, no state library.
  Styling: design-system classes in src/index.css + inline styles. Emoji as icons.
  All HTTP through src/api.ts authFetch (JWT in localStorage `arc_token`).
- Backend: one router per domain in src/routes/; shared src/middleware/auth.ts,
  src/lib/supabase.ts, src/config.ts (fail-fast env validation). Errors: try/catch per
  route, `{ error: string }` shape, consistent status codes.
- AI calls ONLY via src/ai-provider.ts — Ollama primary when AI_PROVIDER=ollama,
  auto-fallback to Gemini via @google/genai (`gemini-2.5-flash`). Key resolution:
  owner env key → user's stored key → trial key (FREE_MESSAGE_LIMIT, 402 when exhausted).
- Embeddings: `gemini-embedding-001` with outputDimensionality 768 (remote) /
  `nomic-embed-text` (Ollama, 768-dim). Model names isolated in config so swapping is a
  one-line change. entries.embedding vector(768) + entries.embedding_model; retrieval
  only matches entries embedded by the active model. Backfill script doubles as re-embed
  tool on model switch.
- OCR: Gemini Flash Vision → tesseract.js (eng+hin+tel) fallback. Gated to owner +
  own-API-key users; trial users get an explanatory 403.
- TTS: msedge-tts backend endpoint → client SpeechSynthesis fallback. STT: Web Speech API
  (+ @capacitor-community/speech-recognition on Android if better).

## Database (Supabase)
users(username PK, pin_hash, pin_length, is_owner, free_limit, chat_count, user_api_key,
      has_api_key, custom_tags JSONB, notification settings columns [v1])
entries(id, username FK, text, activity, mood/mood_label [AI-scored], mood_user/
        mood_user_label, created_at, embedding vector(768) [v1], embedding_model [v1],
        is_favorite [v1])
chat_sessions(id, username, title, created_at) / chat_messages(id, session_id, role,
        content, created_at)
pattern_summaries [v1: last 4 weekly rows per user] / device_tokens [v1]
RPCs [v1]: match_entries(...), match_entries_before(...) [excludes last 30 days]
Migrations live in supabase/migrations/ and are documented in README.
Mood scoring is fire-and-forget after entry insert; frontend polls GET /entries/:id.

## AI persona: "Smriti"
Four-layer system prompt (src/prompts/): identity → CBT(40%)/MI(35%)/ACT(25%) frameworks →
boundaries (never diagnose/prescribe; escalate crisis signals warmly to professional help;
no toxic positivity) → style (warm, direct, matches user's energy, quotes user's own words,
questions over answers, entries referenced by content not metadata).
Retrieval is GATED by intent — Ollama path: classifier prompt returning
retrieve/converse/escalade; Gemini path: search_journal tool-calling. Conversational
partner first, archive second. Latest pattern_summaries always injected into context.

## Mobile
Capacitor wraps the same Vite build (webDir dist). No code forking — capability detection
in src/native.ts. google-services.json → android/app/ (kept tracked in git). APK
build/signing is manual in Android Studio; distribution via Firebase App Distribution.
Web must keep working independently.

## Commands
frontend: npm run dev / build / lint
backend:  npm run dev (tsx watch) / npm run build (tsc → dist/) / npm start (node dist/index.js)
capacitor: npx cap sync && npx cap open android

## Env vars
backend: SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET, PORT, AI_PROVIDER,
OLLAMA_MODEL, OLLAMA_URL, GOOGLE_API_KEY_TRIAL, GOOGLE_API_KEY_OWNER, OWNER_USERNAME,
FREE_MESSAGE_LIMIT, FRONTEND_ORIGIN [v1]
frontend: VITE_API_URL

## Manual steps owned by the user (prompt them at the right time)
- Render dashboard: build command `npm install && npm run build`, start `node dist/index.js`,
  add FRONTEND_ORIGIN env var.
- Supabase Edge Function secrets: Gemini API key + Firebase service-account JSON (FCM v1).
- Android Studio APK build/signing; placing google-services.json in android/app/.
