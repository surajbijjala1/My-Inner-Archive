# 🌱 My Inner Archive

**My Inner Archive** is a private, AI-powered journaling application designed to help you capture your thoughts, reflect on your emotional patterns, and converse with your own wisdom. Your AI companion only knows what you've written — it reflects your own words and patterns back to you, grounded in CBT, Motivational Interviewing, and ACT.

## ✨ Features

**Journaling**
- **📝 Frictionless Journaling:** Write freely, tag your context (e.g., "Walking", "Reading", custom tags), and choose your mood — or let AI score it for you.
- **📷 Photo Capture → OCR:** Photograph a physical page (or upload one on web) and its text is extracted straight into a new entry. Gemini Flash Vision primary, [tesseract.js](https://github.com/naptha/tesseract.js) (English, Hindi, Telugu) fallback.
- **📚 Bulk Import:** Migrate months of physical journal pages at once — batch-photograph up to 20 pages, each page is OCR'd and auto-segmented into individual entries with suggested tag/mood/date, then reviewed (edit, split, merge, delete) before saving.
- **🎤 Voice Dictation:** Speak your thought instead of typing it, via the Web Speech API (native Android speech recognition supported).
- **⭐ Favorites:** Star entries you want to resurface later — they feed your daily notification pool.

**Your AI companion**
- **🎭 Selectable Personas:** Choose from four companions (`backend/src/prompts/personas.ts`) — **Smriti** (reflective mirror, default), **Mitra** (encouraging friend), **Drishti** (direct, no cushioning), **Sakhi** (quiet listener, rarely advises). Persona only varies identity, style, and how the CBT/MI/ACT frameworks are weighted — the frameworks themselves and the boundaries layer (never diagnose/prescribe, escalate crisis signals warmly, no toxic positivity) are shared and immutable across all four.
- **✍️ Custom Instructions:** Add up to 500 characters of your own guidance for how your companion should talk to you — injected below the boundaries layer with an explicit cannot-override guardrail, so your customization never weakens the safety rules.
- **🤖 Grounded Conversation:** Chat shaped by CBT (reframing distortions), Motivational Interviewing (reflecting your own words), and ACT (accepting difficult feelings rather than fixing them).
- **🎙️ Voice Chat:** Talk instead of typing — a hands-free voice mode listens (Web Speech / native Android recognition), sends your words through the same chat pipeline, and speaks the reply back in a per-persona neural voice ([msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS) on the backend, on-device SpeechSynthesis as the fallback). Tap to interrupt mid-reply.
- **🎯 Intent-Gated Retrieval:** Your companion doesn't dump your journal into every reply. A retrieval gate decides, per message, whether to search your archive (`retrieve`), just talk (`converse`), or gently point toward professional help (`escalate`) — Ollama uses a classifier prompt, Gemini uses tool-calling.
- **🔍 Semantic Search:** Retrieval runs on real embeddings (pgvector + cosine similarity), not keyword matching or "last 30 entries."
- **🕰️ Temporal Awareness:** A secondary search surfaces older, semantically related entries (30+ days back) so patterns across time are noticed: *"You wrote about this in March too — what do you think drives that?"*
- **🧠 Weekly Pattern Summaries:** A background job reads your last 4 weeks of entries and writes a structured reflection (themes, growth, tensions, unnoticed positives) that's always in context — ambient memory of you, independent of retrieval.

**Insights**
- **📈 Mood Timeline:** A shadcn/ui-styled Recharts area chart comparing your self-reported mood against the AI's tonal read of your written words — click any point to jump straight to that entry in your journal.
- **🌳 Context Treemap:** A Recharts Treemap sized by entry count and tinted by average mood shows "Where you write from" — frequency and emotional tone by activity/tag at a glance.
- **🗓️ Calendar Heatmap:** A custom SVG heatmap of the last ~6 months, one cell per day, colored by mood — click a day to jump to its entry.
- **📅 "On This Day":** Surfaces entries from this date in past years.

**Mobile & Notifications**
- **📱 Android App:** The same web app wrapped in [Capacitor](https://capacitorjs.com/) — one codebase, capability-detected native features (camera, push, speech).
- **🔔 Daily Motivational Notifications:** A scheduled job picks a high-mood or starred entry (weighted by recency, mood, and variety, never repeating consecutively) and sends an excerpt via Firebase Cloud Messaging. Tapping it opens the app to that entry.

**Security & Reliability**
- **🔒 Privacy First & PIN Protected:** Quick but secure access using a 4- or 6-digit PIN.
- **🔁 Smart AI Fallback:** Runs entirely locally via [Ollama](https://ollama.com/), with automatic fallback to Gemini if the local server is unreachable. Every user-facing AI path has a fallback; background jobs retry with backoff and degrade gracefully (keep the previous result, skip and retry next tick) rather than failing loudly.

## 🛠️ Tech Stack

**Frontend** — `frontend/`
- React 19 + Vite, **TypeScript**
- Vanilla CSS design system (custom properties, glassmorphism, fluid resizing panels) + inline styles
- Charts: [Recharts](https://recharts.org/) (area chart + treemap) for the mood timeline and context insights; the calendar heatmap is custom raw SVG
- In-app confirmation dialogs for destructive actions (e.g. deleting entries) instead of native `confirm()`
- [Capacitor](https://capacitorjs.com/) for the Android shell (`@capacitor/camera`, `@capacitor/push-notifications`, `@capacitor-community/speech-recognition`)

**Backend** — `backend/`
- Node.js + Express 5, **TypeScript, ESM** (`"type": "module"`)
- **Supabase** (PostgreSQL + **pgvector** for embeddings + **pg_cron** for scheduled jobs)
- JWT + bcrypt authentication
- **[@google/genai](https://github.com/googleapis/js-genai)** — Gemini chat, vision, embeddings, tool-calling
- [tesseract.js](https://github.com/naptha/tesseract.js) — OCR fallback
- Supabase Edge Functions (Deno) — weekly pattern summaries, daily notifications

## 🧠 AI Models

Model names are isolated in `backend/src/config.ts` so swapping any of them is a one-line change. Current assignments (chosen for this project's actual free-tier quotas — check yours at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit)):

| Purpose | Model | Notes |
|---|---|---|
| Chat (Smriti) + intent gate + mood scoring | `gemini-3.1-flash-lite` | Shared, high-quota pool — background scoring never starves chat |
| OCR vision | `gemini-2.5-flash` | Rare, owner-gated calls; quality over quota |
| Embeddings | `gemini-embedding-001` (768-dim) | Retrieval only matches entries embedded by the same model |
| Local (optional) | `llama3.2` (chat) + `nomic-embed-text` (embeddings) via Ollama | Primary when `AI_PROVIDER=ollama`, auto-fallback to Gemini |

Gemma models are **not** used for anything conversational — they don't support system instructions, tool-calling, or JSON schema output, all of which Smriti and the bulk-import pipeline depend on.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A [Supabase](https://supabase.com/) account and project, with the **pgvector** and **pg_cron** extensions enabled
- A Google Gemini API key ([aistudio.google.com](https://aistudio.google.com/app/apikey))
- (Optional) [Ollama](https://ollama.com/) installed locally — pull `llama3.2` and `nomic-embed-text`
- (Optional, for the Android app) [Android Studio](https://developer.android.com/studio), a Firebase project with Cloud Messaging enabled, and `google-services.json`

### 1. Database Setup

Run the migrations in `supabase/migrations/` **in order** via the Supabase SQL Editor:

| File | What it adds |
|---|---|
| `0001_rag.sql` | `entries.embedding` (vector), `embedding_model`, `pattern_summaries` table, `match_entries` / `match_entries_before` RPCs |
| `0002_cron.sql` | Schedules the weekly pattern-summary Edge Function (**run after deploying the function** — see below) |
| `0003_notifications.sql` | `entries.is_favorite`, `device_tokens`, per-user notification settings |
| `0004_cron.sql` | Schedules the daily-notification Edge Function (**run after deploying the function**) |
| `0005_personas.sql` | `users.persona` (default `'smriti'`), `users.custom_instructions` |
| `0006_session_persona.sql` | `chat_sessions.persona` — each chat is pinned to the companion it started with |

The base schema (`users`, `entries`, `chat_sessions`, `chat_messages`) predates these migrations — if you're starting fresh, ask for the base `CREATE TABLE` statements or check `backend/src/routes/` for the exact columns each route reads/writes.

### 2. Environment Variables (`backend/.env`)

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
JWT_SECRET=any_long_random_string_here
PORT=3001

# AI Configuration
AI_PROVIDER=gemini  # or "ollama" for local runs
GOOGLE_API_KEY_TRIAL=your_primary_gemini_api_key
GOOGLE_API_KEY_OWNER=your_owner_gemini_api_key
OWNER_USERNAME=your_chosen_admin_username
FREE_MESSAGE_LIMIT=10

# Ollama (optional)
OLLAMA_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434

# CORS — your deployed frontend origin (production only; localhost is always allowed)
FRONTEND_ORIGIN=https://your-frontend.vercel.app
```

`backend/src/config.ts` validates these at startup and exits with a clear error if anything required is missing.

### 3. Environment Variables (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3001
```

For production/Android builds, set the deployed backend URL in `frontend/.env.production` (Vite bakes this in at build time — an APK built without it will silently call `localhost`).

### 4. Edge Functions (weekly summaries + daily notifications)

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <your-project-ref>

# Weekly pattern summaries
supabase functions deploy weekly-summary --no-verify-jwt
supabase secrets set GEMINI_API_KEY=<your key>

# Daily motivational notifications (requires a Firebase service account)
supabase functions deploy daily-notification --no-verify-jwt
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(tr -d '\n' < path/to/service-account.json)"
```

Then run `0002_cron.sql` and `0004_cron.sql` from the SQL Editor (replace `YOUR_PROJECT_REF` in each file first) — **deploy the function before scheduling it**, or the cron job will call a URL that doesn't exist yet.

### 5. Backfilling Embeddings

If you have existing entries from before the RAG migration (or you switch embedding models), run:

```bash
cd backend
npx tsx scripts/backfill-embeddings.ts
```

Resumable and rate-limit aware — safe to re-run; it only touches entries missing an embedding or embedded by a different model than the active one.

### 6. Running Locally

**Terminal 1: Backend**
```bash
cd backend
npm install
npm run dev      # tsx watch — auto-restarts on change
```

**Terminal 2: Frontend**
```bash
cd frontend
npm install
npm run dev
```

Your app will be available at `http://localhost:5173`.

### 7. Android App (optional)

```bash
cd frontend
npm run build
npx cap sync android
npx cap open android   # opens Android Studio — Run ▶ with a device connected
```

Place `google-services.json` in `frontend/android/app/` before syncing (it's tracked in git — Capacitor's Gradle build needs it to wire up Firebase Cloud Messaging).

## 🌐 Deployment

**Backend (Render)**
1. Connect your repo, root directory `backend/`.
2. Build command: `npm install && npm run build`
3. Start command: `node dist/index.js`
4. Add all backend env vars from step 2 above, including `FRONTEND_ORIGIN` set to your Vercel domain (no trailing slash — CORS matches it exactly).

**Frontend (Vercel)**
1. Connect your repo, root directory `frontend`.
2. Environment variable: `VITE_API_URL` = your Render backend URL.
3. Deploy — the build runs `tsc -b && vite build`.

**Android (Firebase App Distribution)**
APK build and signing is manual in Android Studio. Distribute test builds via Firebase App Distribution from the Firebase console. Firebase is used **only** for Cloud Messaging and App Distribution — hosting and the database stay on Vercel/Supabase.

## 💡 Philosophy

Journaling is intimate. It's easy for technology to overshadow the nuance of honest self-reflection. My Inner Archive handles AI cautiously: your companion is a conversational partner first, an archive second — it doesn't quote your journal at you constantly, and it never diagnoses, prescribes, or forces positivity, regardless of which persona you pick or what custom instructions you give it. When something is genuinely serious, it says so plainly and points toward real help instead of trying to handle it itself.

> *"We are the culmination of 1% of each person, each book, each movie we come across in our life... but when you start choosing that 1% consciously, then only you become what you really want."*
