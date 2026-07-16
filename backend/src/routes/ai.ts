import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import {
  generateChat,
  geminiChatWithSearchTool,
  isOllamaUp,
} from "../ai-provider.js";
import { classifyIntent, type Intent } from "../intent-classifier.js";
import { retrieveContext } from "../retrieval.js";
import { buildCompanionPrompt } from "../prompts/smriti.js";
import type { AuthedRequest, ChatMessage } from "../types.js";

const router = Router();

interface PatternSummaryRow {
  week_start: string;
  summary: string;
}

/** Latest pattern summaries (up to 4) — Smriti's ambient memory (Feature 10). */
async function getPatternSummaries(username: string): Promise<PatternSummaryRow[]> {
  const { data, error } = await supabase
    .from("pattern_summaries")
    .select("week_start, summary")
    .eq("username", username)
    .order("week_start", { ascending: false })
    .limit(4);

  if (error) {
    // Non-fatal: chat works without ambient memory
    console.warn("[WARN] pattern_summaries fetch failed:", error.message);
    return [];
  }
  return data || [];
}

/** Max prior messages rebuilt into the model context per turn. */
const HISTORY_LIMIT = 60;

router.post("/chat", auth, async (req: AuthedRequest, res) => {
  try {
    // New clients send { session_id, message } and the server rebuilds history
    // from chat_messages (keeps request bodies tiny — full-transcript bodies
    // used to blow past the JSON body limit on long chats). Legacy clients
    // (older installed APKs) still send the full { messages } array.
    const { messages: legacyMessages, message, session_id } = req.body as {
      messages?: ChatMessage[];
      message?: string;
      session_id?: string;
    };

    const username = req.user!.username;
    const isOwner = username === config.ownerUsername;

    // Verify session ownership + read its pinned persona (when a session is given)
    let sessionTitle: string | null = null;
    let sessionPersona: string | null = null;
    let sessionExists = false;
    if (session_id) {
      type SessionRow = { username: string; title: string | null; persona?: string | null };

      let session: SessionRow | null = null;
      const withPersona = await supabase
        .from("chat_sessions")
        .select("username, title, persona")
        .eq("id", session_id)
        .single();
      if (!withPersona.error) {
        session = withPersona.data as SessionRow;
      } else {
        // persona column may not exist yet (migration 0006) — retry without it
        const withoutPersona = await supabase
          .from("chat_sessions")
          .select("username, title")
          .eq("id", session_id)
          .single();
        session = (withoutPersona.data as SessionRow | null) ?? null;
      }

      if (!session || session.username !== username) {
        return res.status(403).json({ error: "Not authorized for this session" });
      }
      sessionExists = true;
      sessionTitle = session.title;
      sessionPersona = session.persona ?? null;
    }

    // Assemble the model conversation
    let messages: ChatMessage[];
    if (typeof message === "string" && message.trim()) {
      if (!session_id) {
        return res.status(400).json({ error: "session_id is required with message" });
      }
      const { data: history, error: historyError } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", session_id)
        .order("created_at", { ascending: true });
      if (historyError) {
        return res.status(500).json({ error: "Failed to load chat history" });
      }
      const tail = ((history || []) as ChatMessage[]).slice(-HISTORY_LIMIT);
      messages = [...tail, { role: "user", content: message.trim() }];
    } else if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
      messages = legacyMessages.slice(-HISTORY_LIMIT);
    } else {
      return res.status(400).json({ error: "message (or messages array) is required" });
    }

    // Fetch user record (incl. persona + custom instructions for the prompt)
    const { data: userRecord } = await supabase
      .from("users")
      .select("chat_count, user_api_key, persona, custom_instructions")
      .eq("username", username)
      .single();

    const chatCount: number = userRecord?.chat_count || 0;
    const userApiKey: string | null = userRecord?.user_api_key || null;
    // The session's pinned persona wins; fall back to the user's current
    // selection for legacy sessions created before migration 0006.
    const personaId: string | null = sessionPersona || userRecord?.persona || null;
    const customInstructions: string | null = userRecord?.custom_instructions || null;

    // Determine which API key to use
    let resolvedApiKey: string;
    if (isOwner) {
      resolvedApiKey = config.googleApiKeyOwner;
    } else if (userApiKey) {
      resolvedApiKey = userApiKey;
    } else if (chatCount < config.freeMessageLimit) {
      resolvedApiKey = config.googleApiKeyTrial;
    } else {
      return res.status(402).json({
        error: "free_limit_reached",
        chatCount,
        freeLimit: config.freeMessageLimit,
      });
    }

    const lastUserMsg = messages[messages.length - 1].content;
    const patternSummaries = await getPatternSummaries(username);

    const start = performance.now();
    let reply: string;
    let intent: Intent | "tool" = "converse";
    let retrievedCount = 0;

    // ── The retrieval gate (Feature 1) ────────────────────────────────────────
    // Ollama path: explicit classifier prompt. Gemini path: search_journal tool.
    const useOllamaPath = config.aiProvider === "ollama" && (await isOllamaUp());

    if (useOllamaPath) {
      intent = await classifyIntent(messages, resolvedApiKey);

      let retrievedContext: string | null = null;
      if (intent === "retrieve") {
        const result = await retrieveContext(username, lastUserMsg, resolvedApiKey);
        retrievedContext = result.contextBlock;
        retrievedCount = result.primaryCount + result.temporalCount;
      }

      const systemPrompt = buildCompanionPrompt({
        personaId,
        customInstructions,
        patternSummaries,
        retrievedContext,
        escalate: intent === "escalate",
      });
      reply = await generateChat(messages, systemPrompt, resolvedApiKey);
    } else {
      // Gemini path: the model gates retrieval itself via tool-calling
      intent = "tool";
      const systemPrompt = buildCompanionPrompt({ personaId, customInstructions, patternSummaries });
      const result = await geminiChatWithSearchTool(
        messages,
        systemPrompt,
        resolvedApiKey,
        async (query) => {
          const r = await retrieveContext(username, query || lastUserMsg, resolvedApiKey);
          retrievedCount = r.primaryCount + r.temporalCount;
          return r.contextBlock ?? "No matching journal entries found.";
        }
      );
      reply = result.reply;
      if (result.searched) intent = "retrieve";
    }

    if (!reply) {
      throw new Error("empty reply from model");
    }

    const elapsed = (performance.now() - start).toFixed(0);
    console.log(
      `[METRIC] Chat | user=${username} | session=${session_id || "none"} | ` +
      `provider=${config.aiProvider} | path=${useOllamaPath ? "ollama" : "gemini"} | ` +
      `intent=${intent} | retrieved=${retrievedCount} | latency=${elapsed}ms | msgLen=${reply.length}`
    );

    // Persist messages to chat session (ownership already verified above)
    if (session_id && sessionExists) {
      if (!sessionTitle) {
        const title = lastUserMsg.length > 50 ? lastUserMsg.slice(0, 47) + "..." : lastUserMsg;
        await supabase.from("chat_sessions").update({ title }).eq("id", session_id);
      }

      await supabase.from("chat_messages").insert([
        { session_id, role: "user", content: lastUserMsg },
        { session_id, role: "assistant", content: reply },
      ]);
    }

    // Increment chat count for trial users
    if (!isOwner && !userApiKey) {
      await supabase
        .from("users")
        .update({ chat_count: chatCount + 1 })
        .eq("username", username);
    }

    const newCount = isOwner || userApiKey ? chatCount : chatCount + 1;
    return res.json({
      reply,
      chatCount: newCount,
      freeLimit: config.freeMessageLimit,
      isOwner,
      hasApiKey: !!userApiKey,
    });
  } catch (e) {
    console.error(`[ERROR] Chat | user=${req.user?.username} |`, (e as Error).message);
    return res.status(500).json({ error: "AI request failed. Please try again." });
  }
});

export default router;
