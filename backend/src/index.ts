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
import patternRoutes from "./routes/patterns.js";
import ttsRoutes from "./routes/tts.js";
import { authLimiter, chatLimiter, heavyLimiter } from "./middleware/rate-limit.js";
import { requestContext } from "./middleware/request-context.js";
import { breakers } from "./lib/resilience.js";
import { initTelemetry } from "./lib/telemetry.js";

await initTelemetry();

const app = express();

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

app.use("/auth", authLimiter, authRoutes);
app.use("/entries", entryRoutes);
app.use("/ai", chatLimiter, aiRoutes);
app.use("/user", userRoutes);
app.use("/chats", chatRoutes);
app.use("/ocr", heavyLimiter, ocrRoutes);
app.use("/notifications", notificationRoutes);
app.use("/patterns", patternRoutes);
app.use("/tts", heavyLimiter, ttsRoutes);

app.listen(config.port, () =>
  console.log(`Server running on port ${config.port} | AI provider: ${config.aiProvider}`)
);
