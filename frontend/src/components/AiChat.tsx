import { useState, useRef, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { sendChat, createChatSession, storeSessionId } from "../api";
import type { ChatMessage, PersonaMeta } from "../types";
import MdText from "./MdText";
import ApiKeyModal from "./ApiKeyModal";

// Fallback while the persona catalog loads (matches the Smriti persona)
const DEFAULT_WELCOME =
  "🌱 I'm **Smriti** — your memory, reflected. Everything I know comes from your own " +
  "words, and I'll hold onto the patterns even when you can't see them. What's on your mind?";
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
}: AiChatProps) {
  const welcome = persona?.welcome ?? DEFAULT_WELCOME;
  const suggestions = persona?.suggestions ?? DEFAULT_SUGGESTIONS;
  const companionName = persona?.name ?? "Smriti";
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatCount, setChatCount] = useState(initialChatCount || 0);
  const [hasApiKey, setHasApiKey] = useState(initialHasApiKey || false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px"; // ~6 lines max
  };

  useEffect(() => { setChatCount(initialChatCount || 0); }, [initialChatCount]);
  useEffect(() => { setHasApiKey(initialHasApiKey || false); }, [initialHasApiKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const freeRemaining = isOwner || hasApiKey ? null : Math.max(0, freeLimit - chatCount);

  const send = async (preset?: string) => {
    const msg = (preset || input).trim();
    if (!msg || loading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto"; // collapse after send

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
        setMsgs([...msgs, { role: "user", content: msg }, { role: "assistant", content: "Failed to create session. Please try again." }]);
        return;
      }
    }

    const newMsgs: ChatMessage[] = [...msgs, { role: "user", content: msg }];
    setMsgs(newMsgs);
    setLoading(true);

    try {
      const data = await sendChat(msg, sid);

      if (data.error === "free_limit_reached") {
        setMsgs(msgs); // revert user message
        setShowKeyModal(true);
        setLoading(false);
        return;
      }

      setMsgs([...newMsgs, { role: "assistant", content: data.reply ?? "" }]);
      if (data.chatCount !== undefined) setChatCount(data.chatCount);
      if (data.hasApiKey !== undefined) setHasApiKey(data.hasApiKey);
    } catch {
      setMsgs([...newMsgs, { role: "assistant", content: "Connection failed. Please try again." }]);
    }

    setLoading(false);
  };

  const handleKeySaved = () => {
    setShowKeyModal(false);
    setHasApiKey(true);
  };

  return (
    <div style={{ flex: 1, padding: "var(--space-lg)", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header with New Chat button */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4, gap: 10, flexWrap: "wrap" }}>
        <div className="panel-title">{persona ? `${persona.emoji} ${companionName}` : "Your AI Companion"}</div>
        {msgs.length > 0 && (
          <button className="new-chat-btn" onClick={onNewChat} title="Start new conversation">
            🆕 New Chat
          </button>
        )}
        {isOwner ? (
          <span className="ai-badge ai-badge--owner">✓ Owner — unlimited</span>
        ) : hasApiKey ? (
          <span className="ai-badge ai-badge--key">✓ Your key active</span>
        ) : freeRemaining !== null ? (
          <span className="ai-badge ai-badge--trial">
            {freeRemaining > 0 ? `${freeRemaining} free messages left` : "Free limit reached"}
          </span>
        ) : null}
      </div>
      <div className="panel-sub">Powered entirely by your own words</div>

      {/* Messages */}
      <div className="chat-box">
        {msgs.length === 0 && (
          <div className="chat-welcome">
            {personas.length > 1 && (
              <div className="persona-picker-inline">
                <div className="persona-picker-inline-label">Talking to:</div>
                <div className="persona-chip-row">
                  {personas.map((p) => (
                    <button
                      key={p.id}
                      className={`persona-chip ${p.id === persona?.id ? "persona-chip--active" : ""}`}
                      onClick={() => onSelectPersona(p.id)}
                      title={p.description}
                    >
                      {p.emoji} {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <MdText text={welcome} />
            <div style={{ marginTop: 10, fontSize: "12.5px", color: "var(--text-tertiary)" }}>Or start from one of these:</div>
            {suggestions.map((s) => (
              <button key={s} className="chat-suggestion" onClick={() => send(s)}>
                💬 "{s}"
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`chat-bubble-row ${m.role === "user" ? "chat-bubble-row--user" : "chat-bubble-row--ai"}`}>
            <div className={m.role === "user" ? "chat-bubble--user" : "chat-bubble--ai"}>
              {m.role === "user" ? m.content : <MdText text={m.content} />}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-bubble-row chat-bubble-row--ai">
            <div className="chat-bubble--ai chat-fetching">
              <span className="fetching-dot" />
              <span className="fetching-dot" />
              <span className="fetching-dot" />
              <span className="fetching-text">Fetching</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input — auto-growing textarea so long messages stay fully visible */}
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input chat-input--multiline"
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
          placeholder="Ask about your thoughts..."
          disabled={loading}
        />
        <button className="chat-send-btn" onClick={() => send()} disabled={loading || !input.trim()}>
          →
        </button>
      </div>

      {showKeyModal && <ApiKeyModal onSaved={handleKeySaved} onDismiss={() => setShowKeyModal(false)} />}
    </div>
  );
}
