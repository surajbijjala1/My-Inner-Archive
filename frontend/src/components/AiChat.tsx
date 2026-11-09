import { useState, useRef, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { sendChat, createChatSession, storeSessionId } from "../api";
import { hasWebSpeech, isNativeApp } from "../native";
import type { ChatMessage, PersonaMeta } from "../types";
import MdText from "./MdText";
import ApiKeyModal from "./ApiKeyModal";
import VoiceChat from "./VoiceChat";

// Fallback while the persona catalog loads (matches the Smriti persona)
const DEFAULT_WELCOME =
  "I'm **Smriti** — your memory, reflected. Everything I know comes from your own " +
  "words, and I'll hold onto the patterns even when you can't see them. What's on your mind?";

const MenuIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <path d="M5 8.5c4.7-.6 9.3-.6 14-.2" />
    <path d="M5.5 12.3c4.2-.45 8.5-.5 13-.15" />
    <path d="M5 16.1c4.9-.55 9.4-.45 13.7-.05" />
  </svg>
);

const VoiceIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <rect x="9.5" y="3.5" width="5" height="9.5" rx="2.5" />
    <line x1="12" y1="16" x2="12" y2="19.5" />
    <line x1="9" y1="19.5" x2="15" y2="19.5" />
  </svg>
);

const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="18" y2="12" />
    <polyline points="12 6 18 12 12 18" />
  </svg>
);
const DEFAULT_SUGGESTIONS: string[] = [
  "What patterns have you noticed in me lately?",
  "I need to think something through",
  "Show me a moment I was proud of",
  "How have I been doing this month?",
];

interface AiChatProps {
  sessionId: string | null;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  msgs: ChatMessage[];
  setMsgs: Dispatch<SetStateAction<ChatMessage[]>>;
  onNewChat: () => void;
  chatCount: number;
  freeLimit: number;
  hasApiKey: boolean;
  isOwner: boolean;
  /** Active companion persona (null while the catalog loads). */
  persona: PersonaMeta | null;
  /** Full catalog, for the pre-chat picker. */
  personas: PersonaMeta[];
  /** Switch persona — only offered before the first message of a conversation. */
  onSelectPersona: (id: string) => void;
  /** Reports the persona the lazily-created session was pinned to. */
  onSessionCreated: (persona: string | null) => void;
  /** The chat replaces the global action bar on a narrow page, so it carries
   *  the menu itself. */
  onOpenNav: () => void;
}

export default function AiChat({
  sessionId,
  setSessionId,
  msgs,
  setMsgs,
  onNewChat,
  chatCount: initialChatCount,
  freeLimit,
  hasApiKey: initialHasApiKey,
  isOwner,
  persona,
  personas,
  onSelectPersona,
  onSessionCreated,
  onOpenNav,
}: AiChatProps) {
  // Persona welcomes carry a leading emoji; the paper design has no icons here.
  const welcome = (persona?.welcome ?? DEFAULT_WELCOME).replace(/^\s*\P{L}+\s*/u, "");
  const suggestions = persona?.suggestions ?? DEFAULT_SUGGESTIONS;
  const companionName = persona?.name ?? "Smriti";
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatCount, setChatCount] = useState(initialChatCount || 0);
  const [hasApiKey, setHasApiKey] = useState(initialHasApiKey || false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const voiceSupported = isNativeApp() || hasWebSpeech();
  // Free limit hit mid-voice-chat: surface the key modal, not a stuck overlay
  useEffect(() => { if (showKeyModal) setShowVoice(false); }, [showKeyModal]);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px"; // ~6 lines max
  };

  useEffect(() => { setChatCount(initialChatCount || 0); }, [initialChatCount]);
  useEffect(() => { setHasApiKey(initialHasApiKey || false); }, [initialHasApiKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const freeRemaining = isOwner || hasApiKey ? null : Math.max(0, freeLimit - chatCount);

  // Shared delivery pipeline for typed and spoken messages. Resolves with the
  // assistant's reply text (voice mode speaks it), or null on any failure.
  const deliverMessage = useCallback(async (msg: string): Promise<string | null> => {
    // Lazy session creation — only on first message of a new conversation
    let sid = sessionId;
    if (!sid) {
      try {
        const session = await createChatSession();
        sid = session.session_id;
        setSessionId(sid);
        storeSessionId(sid);
        onSessionCreated(session.persona ?? null);
      } catch {
        setMsgs((prev) => [...prev, { role: "user", content: msg }, { role: "assistant", content: "Failed to create session. Please try again." }]);
        return null;
      }
    }

    setMsgs((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const data = await sendChat(msg, sid);

      if (data.error === "free_limit_reached") {
        setMsgs((prev) => prev.slice(0, -1)); // revert user message
        setShowKeyModal(true);
        return null;
      }

      setMsgs((prev) => [...prev, { role: "assistant", content: data.reply ?? "" }]);
      if (data.chatCount !== undefined) setChatCount(data.chatCount);
      if (data.hasApiKey !== undefined) setHasApiKey(data.hasApiKey);
      return data.reply ?? null;
    } catch {
      setMsgs((prev) => [...prev, { role: "assistant", content: "Connection failed. Please try again." }]);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sessionId, setSessionId, setMsgs, onSessionCreated]);

  const send = async (preset?: string) => {
    const msg = (preset || input).trim();
    if (!msg || loading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto"; // collapse after send
    await deliverMessage(msg);
  };

  const handleKeySaved = () => {
    setShowKeyModal(false);
    setHasApiKey(true);
  };

  return (
    <div className="chat-panel">
      {/* Who you are talking to — and, before the first message, who else you could. */}
      <div className="chat-who">
        {personas.length > 1 && msgs.length === 0 ? (
          personas.map((p) => (
            <button
              key={p.id}
              className={`chat-who-name ${p.id === persona?.id ? "chat-who-name--current" : ""}`}
              onClick={() => onSelectPersona(p.id)}
              title={p.description}
            >
              {p.name}
            </button>
          ))
        ) : (
          <span className="chat-who-name chat-who-name--current">{companionName}</span>
        )}
        <span className="chat-who-spacer" />
        {msgs.length > 0 && (
          <button className="chat-who-new" onClick={onNewChat}>
            start again
          </button>
        )}
        {isOwner ? null : hasApiKey ? null : freeRemaining !== null ? (
          <span className="chat-who-left">
            {freeRemaining > 0 ? `${freeRemaining} left` : "that's the last one"}
          </span>
        ) : null}
      </div>

      {/* Messages */}
      <div className="chat-box">
        {msgs.length === 0 && (
          <div className="chat-welcome">
            <div className="chat-opening">
              <MdText text={welcome} />
            </div>
            <div className="chat-openers">
              {suggestions.map((s) => (
                <button key={s} className="chat-opener" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="said-you">{m.content}</p>
          ) : (
            <div key={i} className="said-them">
              <MdText text={m.content} />
            </div>
          )
        )}

        {loading && (
          <div className="said-them chat-fetching">
            <span className="fetching-dot" />
            <span className="fetching-dot" />
            <span className="fetching-dot" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* The conversation dissolves into the paper before the line you write on. */}
      <div className="chat-fade" aria-hidden="true" />

      <div className="chat-line">
        <button
          className="action-btn mobile-only-inline"
          onClick={onOpenNav}
          aria-label="Go to"
        >
          <MenuIcon />
        </button>
        {voiceSupported && (
          <button
            className="action-btn"
            onClick={() => setShowVoice(true)}
            disabled={loading}
            aria-label={`Voice chat with ${companionName}`}
          >
            <VoiceIcon />
          </button>
        )}
        <textarea
          ref={inputRef}
          className="chat-line-input"
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="whatever's there"
          disabled={loading}
        />
        <button
          className="action-btn chat-send"
          onClick={() => send()}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>

      {showVoice && (
        <VoiceChat
          persona={persona}
          onSend={deliverMessage}
          onClose={() => setShowVoice(false)}
        />
      )}

      {showKeyModal && <ApiKeyModal onSaved={handleKeySaved} onDismiss={() => setShowKeyModal(false)} />}
    </div>
  );
}
