import { config } from "./config.js";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import entryRoutes from "./routes/entries.js";
import aiRoutes from "./routes/ai.js";
import userRoutes from "./routes/user.js";
import chatRoutes from "./routes/chats.js";

const app = express();

// CORS locked to the deployed frontend + local dev.
// Requests without an Origin header (curl, native apps) are not blocked by CORS.
const allowedOrigins = [
  "http://localhost:5173",
  ...(config.frontendOrigin ? [config.frontendOrigin] : []),
];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/entries", entryRoutes);
app.use("/ai", aiRoutes);
app.use("/user", userRoutes);
app.use("/chats", chatRoutes);

app.listen(config.port, () =>
  console.log(`Server running on port ${config.port} | AI provider: ${config.aiProvider}`)
);
