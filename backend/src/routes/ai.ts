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
import { detectCrisis } from "../safety-classifier.js";
import { checkReply, shouldAuditReply } from "../boundary-classifier.js";
import { getPersona } from "../prompts/personas.js";
import { currentContext, setContextField, withSpan } from "../lib/telemetry.js";
import { retrieveContext } from "../retrieval.js";
import { buildCompanionPrompt } from "../prompts/smriti.js";
import type { AuthedRequest, ChatMessage } from "../types.js";
import { LIMITS, tooLong } from "../lib/limits.js";

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

/** Shape check for the legacy full-transcript body. Returns an error message
 *  or null. Content of any turn is bounded so a legacy body can't smuggle in
 *  an oversized history. */
function validateLegacyMessages(msgs: unknown[]): string | null {
  for (const m of msgs) {
    const turn = m as { role?: unknown; content?: unknown } | null;
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) {
      return "Each message needs a role of user or assistant";
    }
    if (typeof turn.content !== "string") return "Each message needs text content";
    if (turn.content.length > LIMITS.chatMessageChars) return "A message in the history is too long";
  }
  const last = msgs[msgs.length - 1] as { role: string; content: string };
  if (last.role !== "user" || !last.content.trim()) return "The last message must be from the user";
  return null;
}

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
    // Attach identity to the trace context now that auth has run
    setContextField("username", username);
    if (session_id) setContextField("sessionId", session_id);

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

    // Assemble the model conversation. The newest user turn comes from
    // `message` (current clients) or the last entry of a legacy `messages`
    // array. History is NEVER taken from the client when there is a session:
    // it is rebuilt from what the server stored, so a client can't put words
    // in the companion's mouth by sending forged assistant turns.
    let newTurn: string;
    let clientHistory: ChatMessage[] = [];
    if (typeof message === "string" && message.trim()) {
      if (!session_id) {
        return res.status(400).json({ error: "session_id is required with message" });
      }
      newTurn = message.trim();
    } else if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
      const shapeErr = validateLegacyMessages(legacyMessages);
      if (shapeErr) return res.status(400).json({ error: shapeErr });
      newTurn = legacyMessages[legacyMessages.length - 1].content.trim();
      clientHistory = legacyMessages.slice(0, -1);
    } else {
      return res.status(400).json({ error: "message (or messages array) is required" });
    }
    const sizeErr = tooLong(newTurn, LIMITS.chatMessageChars, "Message");
    if (sizeErr) return res.status(400).json({ error: sizeErr });

    let history: ChatMessage[];
    if (session_id) {
      const { data: stored, error: historyError } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", session_id)
        .order("created_at", { ascending: true });
      if (historyError) {
        return res.status(500).json({ error: "Failed to load chat history" });
      }
      history = (stored || []) as ChatMessage[];
    } else {
      // Legacy client without a session: nothing is persisted, so a forged
      // turn can only steer its own reply — which the output audit still checks.
      history = clientHistory;
    }
    const messages: ChatMessage[] = [
      ...history.slice(-(HISTORY_LIMIT - 1)),
      { role: "user", content: newTurn },
    ];

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

    const start = performance.now();
    let reply: string;
    let intent: Intent | "tool" = "converse";
    let retrievedCount = 0;

    // ── The safety gate ───────────────────────────────────────────────────────
    // Runs on EVERY turn on EVERY provider path, in parallel with the pattern-
    // summary fetch so it costs no extra wall-clock time. Previously escalation
    // rode on the Ollama-only retrieval classifier, which meant it never fired
    // in the default Gemini deployment.
    const [patternSummaries, escalate] = await Promise.all([
      getPatternSummaries(username),
      detectCrisis(messages, resolvedApiKey),
    ]);

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
        escalate,
      });
      reply = await generateChat(messages, systemPrompt, resolvedApiKey);
    } else {
      // Gemini path: the model gates retrieval itself via tool-calling
      intent = "tool";
      const systemPrompt = buildCompanionPrompt({
        personaId,
        customInstructions,
        patternSummaries,
        escalate,
      });
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

    // ── The relational-boundary output gate ───────────────────────────────────
    // Inspects what we're about to SEND, which is what makes it robust: it
    // doesn't matter how the text was elicited — roleplay, an assigned
    // character, gradual escalation over many turns. Prompt-only defenses lost
    // to all three.
    //
    // Gated to keep ordinary turns free: a cheap heuristic decides whether to
    // spend a model call at all, so normal conversation pays nothing.
    let boundaryBlocked = false;
    if (shouldAuditReply(reply, messages)) {
      const violated = await checkReply(reply, messages, resolvedApiKey);
      if (violated) {
        boundaryBlocked = true;
        console.warn(
          `[SAFETY] boundary violation blocked | req=${currentContext()?.requestId?.slice(0, 8) ?? "-"} | ` +
          `user=${username} | persona=${personaId ?? "default"}`
        );

        // One regeneration with an explicit corrective. Usually enough — the
        // model isn't trying to violate, it lost the thread inside the fiction.
        const correctedPrompt = buildCompanionPrompt({
          personaId,
          customInstructions,
          patternSummaries,
          escalate,
          boundaryCorrection: true,
        });
        try {
          const retry = await generateChat(messages, correctedPrompt, resolvedApiKey);
          reply = retry && !(await checkReply(retry, messages, resolvedApiKey))
            ? retry
            : getPersona(personaId).boundaryRedirect;
        } catch {
          reply = getPersona(personaId).boundaryRedirect;
        }
      }
    }

    const elapsed = (performance.now() - start).toFixed(0);
    // Per-call model/token/cost detail lives in the trace spans; this line stays
    // as a human-readable summary of the turn as a whole.
    console.log(
      `[METRIC] Chat | req=${currentContext()?.requestId?.slice(0, 8) ?? "-"} | ` +
      `user=${username} | session=${session_id || "none"} | ` +
      `provider=${config.aiProvider} | path=${useOllamaPath ? "ollama" : "gemini"} | ` +
      `intent=${intent} | escalate=${escalate} | boundaryBlocked=${boundaryBlocked} | ` +
      `retrieved=${retrievedCount} | latency=${elapsed}ms | msgLen=${reply.length}`
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

    // Increment chat count for trial users. Atomic RPC, not a read-modify-write
    // around the AI call — concurrent turns used to all write the same value.
    let newCount = chatCount;
    if (!isOwner && !userApiKey) {
      const { data: updated, error: incErr } = await supabase.rpc("increment_chat_count", {
        p_username: username,
      });
      if (incErr) {
        // Migration 0007 not applied yet — fall back to the old path
        await supabase
          .from("users")
          .update({ chat_count: chatCount + 1 })
          .eq("username", username);
        newCount = chatCount + 1;
      } else {
        newCount = typeof updated === "number" ? updated : chatCount + 1;
      }
    }
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
