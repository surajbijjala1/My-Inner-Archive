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

const app = express();

// CORS locked to the deployed frontend + local dev.
// Requests without an Origin header (curl, native apps) are not blocked by CORS.
const allowedOrigins = [
  "http://localhost:5173",
  ...(config.frontendOrigin ? [config.frontendOrigin] : []),
];
app.use(cors({ origin: allowedOrigins }));

// /ocr parses its own body with a 15mb limit (base64 images) — skip the
// default parser there so its small limit doesn't reject uploads first.
const jsonParser = express.json();
app.use((req, res, next) =>
  req.path.startsWith("/ocr") ? next() : jsonParser(req, res, next)
);

app.use("/auth", authRoutes);
app.use("/entries", entryRoutes);
app.use("/ai", aiRoutes);
app.use("/user", userRoutes);
app.use("/chats", chatRoutes);
app.use("/ocr", ocrRoutes);
app.use("/notifications", notificationRoutes);

app.listen(config.port, () =>
  console.log(`Server running on port ${config.port} | AI provider: ${config.aiProvider}`)
);
