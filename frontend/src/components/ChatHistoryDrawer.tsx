import { useState, useEffect } from "react";
import type { MouseEvent } from "react";
import { getChatSessions, deleteChatSession } from "../api";
import type { ChatSession } from "../types";
import ConfirmDialog from "./ConfirmDialog";

interface ChatHistoryDrawerProps {
  currentSessionId: string | null;
  onClose: () => void;
  onResumeSession: (session: ChatSession) => void;
}

export default function ChatHistoryDrawer({ currentSessionId, onClose, onResumeSession }: ChatHistoryDrawerProps) {
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);

  // Load sessions on mount
  useEffect(() => {
    const load = async () => {
      setLoadingSessions(true);
      try {
        const data = await getChatSessions();
        setSessions(data);
      } catch {
        setSessions([]);
      }
      setLoadingSessions(false);
    };
    load();
  }, []);

  const handleDeleteClick = (e: MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    setSessionToDelete(session);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    const id = sessionToDelete.id;
    setSessionToDelete(null);
    try {
      await deleteChatSession(id);
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } catch {
      alert("Failed to delete session");
    }
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content chat-history-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440, width: "95vw", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div className="modal-title" style={{ margin: 0 }}>💬 Chat History</div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", fontSize: "18px",
              cursor: "pointer", color: "var(--text-tertiary)", padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loadingSessions ? (
            <div className="loading-pulse" style={{ fontSize: "13px", color: "var(--text-muted)", padding: 16, textAlign: "center" }}>
              Loading sessions...
            </div>
          ) : sessions && sessions.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "13px", padding: 24 }}>
              No chat sessions yet. Start a conversation to see your history here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(sessions || []).map((s) => {
                const isCurrent = s.id === currentSessionId;
                return (
                  <div
                    key={s.id}
                    className="session-row"
                    onClick={() => !isCurrent && onResumeSession(s)}
                    style={{
                      textAlign: "left", padding: "12px 14px",
                      background: isCurrent ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                      border: isCurrent ? "1.5px solid var(--border-medium)" : "1.5px solid transparent",
                      borderRadius: "var(--radius-md)",
                      cursor: isCurrent ? "default" : "pointer",
                      display: "flex", alignItems: "center", gap: 10,
                      transition: "background 0.15s",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "13.5px", color: "var(--text-primary)", marginBottom: 4 }}>
                        {s.title || "Untitled session"}
                        {isCurrent && (
                          <span style={{
                            marginLeft: 8, fontSize: "11px", color: "#4a8",
                            background: "#4a820", borderRadius: "10px", padding: "2px 8px",
                          }}>
                            Current
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                        {formatDate(s.created_at)}
                        {s.message_count > 0 && ` · ${s.message_count} messages`}
                      </div>
                    </div>

                    {/* Delete button */}
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteClick(e, s)}
                      title="Delete session"
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {sessionToDelete && (
        <ConfirmDialog
          title="🗑 Delete this chat?"
          message="The conversation and all its messages will be permanently removed."
          excerpt={sessionToDelete.title || "Untitled session"}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setSessionToDelete(null)}
        />
      )}
    </div>
  );
}
