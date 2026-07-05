import { useState, useEffect, useRef } from "react";
import { moodColor } from "../utils";
import { getEntryMood } from "../api";
import type { Entry, EntryMood } from "../types";

interface EntryListProps {
  entries: Entry[];
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
}

export default function EntryList({ entries, onDelete, onUpdateEntry }: EntryListProps) {
  return (
    <div>
      <div className="section-label">
        Archive · {entries.length} {entries.length === 1 ? "entry" : "entries"}
      </div>

      {entries.length === 0 ? (
        <div className="entry-empty">Your thoughts will live here. Start writing ✨</div>
      ) : (
        entries.map((e) => (
          <EntryCard key={e.id} entry={e} onDelete={onDelete} onUpdateEntry={onUpdateEntry} />
        ))
      )}
    </div>
  );
}

interface EntryCardProps {
  entry: Entry;
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
}

function EntryCard({ entry: e, onDelete, onUpdateEntry }: EntryCardProps) {
  const [polling, setPolling] = useState(!e.mood);
  const retries = useRef(0);

  useEffect(() => {
    if (!polling || e.mood != null) {
      setPolling(false);
      return;
    }

    const timer = setInterval(async () => {
      retries.current += 1;
      try {
        const data = await getEntryMood(e.id);
        if (data && data.mood != null) {
          onUpdateEntry(e.id, data);
          setPolling(false);
        }
      } catch {
        // ignore poll errors
      }
      if (retries.current >= 10) {
        setPolling(false); // give up after ~30s
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [polling, e.mood, e.id, onUpdateEntry]);

  const userScore = e.mood_user;
  const aiScore = e.mood;

  return (
    <div className="entry-card">
      <button className="entry-delete-btn" onClick={() => onDelete(e.id)} title="Delete entry">
        ✕
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
        ) : polling ? (
          <span className="entry-mood entry-mood--scoring">
            🤖 Scoring...
          </span>
        ) : null}
      </div>
      <div className="entry-text">{e.text}</div>
    </div>
  );
}
