import { config } from "./config.js";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import entryRoutes from "./routes/entries.js";
import aiRoutes from "./routes/ai.js";
import userRoutes from "./routes/user.js";
import chatRoutes from "./routes/chats.js";
import ocrRoutes from "./routes/ocr.js";
import notificationRoutes from "./routes/notifications.js";
import ttsRoutes from "./routes/tts.js";
import { chatLimiter, heavyLimiter } from "./middleware/rate-limit.js";
import { auth } from "./middleware/auth.js";
import { requestContext } from "./middleware/request-context.js";
import { breakers } from "./lib/resilience.js";
import { initTelemetry } from "./lib/telemetry.js";

await initTelemetry();

const app = express();

// Render sits one proxy hop in front of us. Without this, req.ip is the
// proxy's address and every IP-keyed rate limit becomes one shared bucket.
// Exactly 1 hop, not `true`: trusting every X-Forwarded-For entry would let a
// client spoof its IP and walk out of its limit.
app.set("trust proxy", 1);

// CORS locked to the deployed frontend + local dev + the Capacitor shell.
// The Android WebView serves the app from https://localhost (capacitor://localhost
// on iOS) — without these the APK's requests are CORS-blocked.
// Requests without an Origin header (curl) are not blocked by CORS.
const allowedOrigins = [
  "http://localhost:5173",
  "https://localhost",
  "capacitor://localhost",
  ...(config.frontendOrigin ? [config.frontendOrigin] : []),
];
app.use(cors({ origin: allowedOrigins }));
app.use(requestContext);

// /ocr parses its own body with a 15mb limit (base64 images) — skip the
// default parser there so its small limit doesn't reject uploads first.
// 2mb (not the 100kb default): older installed APKs still send the full chat
// transcript in the body until they're rebuilt against the session_id+message API.
const jsonParser = express.json({ limit: "2mb" });
app.use((req, res, next) =>
  req.path.startsWith("/ocr") ? next() : jsonParser(req, res, next)
);

// Liveness + dependency status. Render's health check and a quick way to see
// whether a provider's circuit breaker has tripped without reading logs.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: config.aiProvider,
    breakers: [breakers.gemini.status, breakers.ollama.status],
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.use("/auth", authRoutes); // per-route limiters live in routes/auth.ts
app.use("/entries", entryRoutes);
// auth runs before the limiter so it keys by the verified username; otherwise
// it falls back to IP and users behind one address throttle each other.
app.use("/ai", auth, chatLimiter, aiRoutes);
app.use("/user", userRoutes);
app.use("/chats", chatRoutes);
app.use("/ocr", auth, heavyLimiter, ocrRoutes);
app.use("/notifications", notificationRoutes);
app.use("/tts", auth, heavyLimiter, ttsRoutes);

app.listen(config.port, () =>
  console.log(`Server running on port ${config.port} | AI provider: ${config.aiProvider}`)
);
