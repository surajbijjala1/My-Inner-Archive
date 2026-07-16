import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { auth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

// POST /chats/session — create a new chat session, pinned to the user's
// currently selected persona (the session keeps that persona forever).
router.post("/session", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;

    const { data: userRow } = await supabase
      .from("users")
      .select("persona")
      .eq("username", username)
      .single();
    const persona: string = userRow?.persona || "smriti";

    let inserted = await supabase
      .from("chat_sessions")
      .insert({ username, title: null, persona })
      .select()
      .single();

    if (inserted.error) {
      // chat_sessions.persona may not exist yet (migration 0006 not applied) —
      // degrade to the pre-persona insert rather than blocking chat entirely.
      inserted = await supabase
        .from("chat_sessions")
        .insert({ username, title: null })
        .select()
        .single();
    }

    if (inserted.error) return res.status(500).json({ error: inserted.error.message });
    res.json({
      session_id: inserted.data.id,
      created_at: inserted.data.created_at,
      persona: inserted.data.persona ?? null,
    });
  } catch (e) {
    console.error("[ERROR] CreateSession |", (e as Error).message);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// GET /chats/sessions — list only non-empty sessions for the user
router.get("/sessions", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;

    // Single query: message counts come back via a PostgREST embedded aggregate,
    // replacing the previous per-session count queries (N+1).
    type SessionListRow = {
      id: string;
      title: string | null;
      created_at: string;
      persona?: string | null;
      chat_messages: { count: number }[] | null;
    };

    let rows: SessionListRow[] | null = null;
    const withPersona = await supabase
      .from("chat_sessions")
      .select("id, title, created_at, persona, chat_messages(count)")
      .eq("username", username)
      .order("created_at", { ascending: false });

    if (!withPersona.error) {
      rows = withPersona.data as unknown as SessionListRow[];
    } else {
      // persona column may not exist yet (migration 0006) — retry without it
      const withoutPersona = await supabase
        .from("chat_sessions")
        .select("id, title, created_at, chat_messages(count)")
        .eq("username", username)
        .order("created_at", { ascending: false });
      if (withoutPersona.error) return res.status(500).json({ error: withoutPersona.error.message });
      rows = withoutPersona.data as unknown as SessionListRow[];
    }

    const enriched = (rows || []).map((s) => ({
      id: s.id,
      title: s.title,
      created_at: s.created_at,
      persona: s.persona ?? null,
      message_count: s.chat_messages?.[0]?.count || 0,
    }));

    // Only return sessions that have at least 1 message
    res.json(enriched.filter((s) => s.message_count > 0));
  } catch (e) {
    console.error("[ERROR] ListSessions |", (e as Error).message);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

// GET /chats/sessions/:id — session metadata (title, persona) for resuming
router.get("/sessions/:id", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;
    const sessionId = req.params.id;

    type SessionMetaRow = {
      id: string;
      username: string;
      title: string | null;
      created_at: string;
      persona?: string | null;
    };

    let row: SessionMetaRow | null = null;
    const withPersona = await supabase
      .from("chat_sessions")
      .select("id, username, title, created_at, persona")
      .eq("id", sessionId)
      .single();

    if (!withPersona.error) {
      row = withPersona.data as SessionMetaRow;
    } else {
      // persona column may not exist yet (migration 0006) — retry without it
      const withoutPersona = await supabase
        .from("chat_sessions")
        .select("id, username, title, created_at")
        .eq("id", sessionId)
        .single();
      row = (withoutPersona.data as SessionMetaRow | null) ?? null;
    }

    if (!row) return res.status(404).json({ error: "Session not found" });
    if (row.username !== username) return res.status(403).json({ error: "Not authorized" });

    res.json({ id: row.id, title: row.title, created_at: row.created_at, persona: row.persona ?? null });
  } catch (e) {
    console.error("[ERROR] GetSession |", (e as Error).message);
    res.status(500).json({ error: "Failed to load session" });
  }
});

// GET /chats/sessions/:id/messages — get all messages for a session
router.get("/sessions/:id/messages", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;
    const sessionId = req.params.id;

    // Verify this session belongs to the user
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("username")
      .eq("id", sessionId)
      .single();

    if (!session || session.username !== username) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { data: messages, error } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(messages || []);
  } catch (e) {
    console.error("[ERROR] GetMessages |", (e as Error).message);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// POST /chats/sessions/:id/messages — save a message to a session
router.post("/sessions/:id/messages", auth, async (req: AuthedRequest, res) => {
  try {
    const { role, content } = req.body as { role?: string; content?: string };
    const sessionId = req.params.id;
    const username = req.user!.username;

    if (!role || !content) return res.status(400).json({ error: "role and content required" });

    // Verify ownership
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("username, title")
      .eq("id", sessionId)
      .single();

    if (!session || session.username !== username) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Auto-set title from first user message
    if (!session.title && role === "user") {
      const title = content.length > 50 ? content.slice(0, 47) + "..." : content;
      await supabase.from("chat_sessions").update({ title }).eq("id", sessionId);
    }

    const { error } = await supabase
      .from("chat_messages")
      .insert({ session_id: sessionId, role, content });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] SaveMessage |", (e as Error).message);
    res.status(500).json({ error: "Failed to save message" });
  }
});

// DELETE /chats/sessions/:id — delete a session and all its messages
router.delete("/sessions/:id", auth, async (req: AuthedRequest, res) => {
  try {
    const sessionId = req.params.id;
    const username = req.user!.username;

    // Verify ownership
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("username")
      .eq("id", sessionId)
      .single();

    if (!session || session.username !== username) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Delete messages first (FK constraint), then session
    const { error: msgErr } = await supabase.from("chat_messages").delete().eq("session_id", sessionId);
    if (msgErr) {
      console.error("[ERROR] Delete chat messages:", msgErr.message);
      return res.status(500).json({ error: msgErr.message });
    }

    const { error: sessErr } = await supabase.from("chat_sessions").delete().eq("id", sessionId);
    if (sessErr) {
      console.error("[ERROR] Delete chat session:", sessErr.message);
      return res.status(500).json({ error: sessErr.message });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] DeleteSession |", (e as Error).message);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
