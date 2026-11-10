import { useState, useEffect, useRef } from "react";
import { moodColor } from "../utils";
import { getEntryMood, setEntryFavorite } from "../api";
import type { Entry, EntryMood } from "../types";

interface EntryListProps {
  entries: Entry[];
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  /** Entry to scroll to and highlight (notification deep link). */
  highlightId?: string | null;
}

export default function EntryList({ entries, onDelete, onUpdateEntry, onToggleFavorite, highlightId }: EntryListProps) {
  return (
    <div>
      <div className="section-label">
        Archive · {entries.length} {entries.length === 1 ? "entry" : "entries"}
      </div>

      {entries.length === 0 ? (
        <div className="entry-empty">Your thoughts will live here. Start writing ✨</div>
      ) : (
        entries.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            onDelete={onDelete}
            onUpdateEntry={onUpdateEntry}
            onToggleFavorite={onToggleFavorite}
            highlighted={e.id === highlightId}
          />
        ))
      )}
    </div>
  );
}

interface EntryCardProps {
  entry: Entry;
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  highlighted: boolean;
}

/** How long to keep polling for an AI mood score. Covers the server's own
 *  retry window (backend/src/routes/entries.ts: up to ~3 minutes). */
const SCORE_POLL_LIMIT_MS = 5 * 60_000;

function EntryCard({ entry: e, onDelete, onUpdateEntry, onToggleFavorite, highlighted }: EntryCardProps) {
  // "Scoring" is derived, not stored: it ends by itself when the score
  // arrives. Only giving up needs state.
  const [gaveUp, setGaveUp] = useState(false);
  const scoring = e.mood == null && !gaveUp;
  const [togglingFav, setTogglingFav] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Notification deep link: scroll to and flash the referenced entry
  useEffect(() => {
    if (highlighted) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  const toggleFavorite = async () => {
    if (togglingFav) return;
    setTogglingFav(true);
    try {
      const result = await setEntryFavorite(e.id, !e.is_favorite);
      onToggleFavorite(e.id, result.is_favorite);
    } catch {
      alert("Failed to update favorite");
    }
    setTogglingFav(false);
  };

  // Poll for the AI mood score. The server retries scoring for up to ~3
  // minutes when Gemini is rate-limited, so polling for only 30s used to give
  // up while the score was still coming and hide it until a reload. Fast at
  // first (most scores land in seconds), then backing off, for 5 minutes.
  useEffect(() => {
    if (!scoring) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();

    const poll = async () => {
      try {
        const data = await getEntryMood(e.id);
        if (cancelled) return;
        if (data && data.mood != null) {
          onUpdateEntry(e.id, data); // e.mood becomes set → scoring ends
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (cancelled) return;
      const elapsed = Date.now() - started;
      if (elapsed >= SCORE_POLL_LIMIT_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(poll, elapsed < 30_000 ? 3_000 : 15_000);
    };
    timer = setTimeout(poll, 3_000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scoring, e.id, onUpdateEntry]);

  const userScore = e.mood_user;
  const aiScore = e.mood;

  return (
    <div id={`entry-${e.id}`} className={`entry-card ${highlighted ? "entry-card--highlighted" : ""}`} ref={cardRef}>
      <button className="entry-delete-btn" onClick={() => onDelete(e.id)} title="Delete entry">
        ✕
      </button>
      <button
        className={`entry-fav-btn ${e.is_favorite ? "entry-fav-btn--active" : ""}`}
        onClick={toggleFavorite}
        disabled={togglingFav}
        title={e.is_favorite ? "Remove from motivation pool" : "Star — may appear in your daily notifications"}
      >
        {e.is_favorite ? "★" : "☆"}
      </button>
      <div className="entry-date">{new Date(e.created_at).toLocaleString()}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
        {e.activity && <span className="entry-activity">{e.activity}</span>}

        {/* User mood badge */}
        {userScore != null && (
          <span
            className="entry-mood"
            style={{
              background: moodColor(userScore) + "22",
              color: moodColor(userScore),
            }}
          >
            You: {e.mood_user_label} {userScore}/10
          </span>
        )}

        {/* AI mood badge — or scoring spinner */}
        {aiScore != null ? (
          <span
            className="entry-mood"
            style={{ background: "#6366f122", color: "#6366f1" }}
          >
            AI: {e.mood_label} {aiScore}/10
          </span>
        ) : scoring ? (
          <span className="entry-mood entry-mood--scoring">
            🤖 Scoring...
          </span>
        ) : null}
      </div>
      <div className="entry-text">{e.text}</div>
    </div>
  );
}
