import { useState, useEffect } from "react";
import type { MouseEvent } from "react";
import { getChatSessions, deleteChatSession } from "../api";
import type { ChatSession, PersonaMeta } from "../types";
import ConfirmDialog from "./ConfirmDialog";

interface ChatHistoryDrawerProps {
  currentSessionId: string | null;
  onClose: () => void;
  onResumeSession: (session: ChatSession) => void;
  /** Persona catalog, for showing which companion each session belongs to. */
  personas: PersonaMeta[];
}

export default function ChatHistoryDrawer({ currentSessionId, onClose, onResumeSession, personas }: ChatHistoryDrawerProps) {
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

  const [deleteError, setDeleteError] = useState("");

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    const id = sessionToDelete.id;
    setSessionToDelete(null);
    setDeleteError("");
    try {
      await deleteChatSession(id);
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } catch {
      setDeleteError("couldn't delete that — try again");
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <div className="sheet-head">
          <div className="modal-title" id="history-title">Past conversations</div>
          <button className="sheet-back" onClick={onClose}>done</button>
        </div>

        {loadingSessions ? (
          <p className="sheet-note loading-pulse">finding them…</p>
        ) : sessions && sessions.length === 0 ? (
          <p className="sheet-text">
            Nothing here yet. Conversations you have with your companion will be kept here.
          </p>
        ) : (
          <ul className="sheet-list">
            {(sessions || []).map((s) => {
              const isCurrent = s.id === currentSessionId;
              const sessionPersona = s.persona ? personas.find((p) => p.id === s.persona) ?? null : null;
              return (
                <li key={s.id} className="sheet-row">
                  <button
                    className="sheet-row-main"
                    onClick={() => onResumeSession(s)}
                    disabled={isCurrent}
                    aria-current={isCurrent ? "true" : undefined}
                  >
                    <span className="sheet-row-title">{s.title || "Untitled conversation"}</span>
                    <span className="sheet-row-meta">
                      {[
                        isCurrent ? "open now" : null,
                        sessionPersona ? `with ${sessionPersona.name}` : null,
                        formatDate(s.created_at),
                        s.message_count > 0 ? `${s.message_count} messages` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  <button
                    className="sheet-row-x"
                    onClick={(e) => handleDeleteClick(e, s)}
                    aria-label={`Delete "${s.title || "Untitled conversation"}"`}
                  >
                    delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {deleteError && <p className="sheet-error" role="alert">{deleteError}</p>}
      </div>

      {sessionToDelete && (
        <ConfirmDialog
          title="Delete this chat?"
          message="The conversation and everything said in it will be gone for good."
          excerpt={sessionToDelete.title || "Untitled session"}
          confirmLabel="delete it"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setSessionToDelete(null)}
        />
      )}
    </div>
  );
}
