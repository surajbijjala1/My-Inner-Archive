import { useCallback, useState } from "react";
import {
  ApiError, clearSessionId, getChatMessages, getSessionMeta, storeSessionId,
} from "../api";
import type { ChatMessage, ChatSession } from "../types";

/**
 * The open conversation. Lifted to App so it survives moving between the
 * journal, the patterns and the chat on a phone.
 */
export function useChat(showNotice: (text: string) => void) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Persona pinned to the resumed session (null = new chat → user's current pick)
  const [sessionPersonaId, setSessionPersonaId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);

  /** Forget the conversation on this page (the stored session id is left alone). */
  const reset = useCallback(() => {
    setChatMsgs([]);
    setSessionId(null);
    setSessionPersonaId(null);
  }, []);

  const newChat = () => {
    reset();
    clearSessionId();
  };

  /** On launch: load the stored session's messages and its pinned persona. */
  const restoreStored = useCallback(async (sid: string) => {
    try {
      const msgs = await getChatMessages(sid);
      setChatMsgs(msgs.map((m) => ({ role: m.role, content: m.content })));
      getSessionMeta(sid)
        .then((meta) => setSessionPersonaId(meta.persona ?? null))
        .catch(() => setSessionPersonaId(null));
    } catch (e) {
      // Start fresh either way. Only forget the stored session when the
      // server says it is gone (or not ours); after a dropped connection
      // it is still there, and the next launch can pick it up again.
      setChatMsgs([]);
      setSessionId(null);
      if (e instanceof ApiError && [400, 403, 404].includes(e.status)) clearSessionId();
    }
  }, []);

  /** Open a past conversation; `onOpened` runs only if it loaded. */
  const resumeSession = async (session: ChatSession, onOpened: () => void) => {
    try {
      const messages = await getChatMessages(session.id);
      setChatMsgs(messages.map((m) => ({ role: m.role, content: m.content })));
      setSessionId(session.id);
      setSessionPersonaId(session.persona ?? null);
      storeSessionId(session.id);
      onOpened();
    } catch {
      showNotice("Couldn't open that conversation — try again in a moment.");
    }
  };

  return {
    sessionId, setSessionId,
    sessionPersonaId, setSessionPersonaId,
    chatMsgs, setChatMsgs,
    reset, newChat, restoreStored, resumeSession,
  };
}

export type Chat = ReturnType<typeof useChat>;
