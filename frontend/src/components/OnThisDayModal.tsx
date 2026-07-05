import { moodColor } from "../utils";
import type { Entry } from "../types";

interface OnThisDayModalProps {
  entries: Entry[];
  onClose: () => void;
}

export default function OnThisDayModal({ entries, onClose }: OnThisDayModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">📅 On This Day</div>
        <div className="modal-subtitle">
          You wrote {entries.length === 1 ? "this" : "these"} on this date in past years:
        </div>

        {entries.map((e) => (
          <div key={e.id} className="entry-card">
            <div className="entry-date">{new Date(e.created_at).toLocaleString()}</div>
            {e.activity && <span className="entry-activity">{e.activity}</span>}
            {e.mood && (
              <span
                className="entry-mood"
                style={{
                  background: moodColor(e.mood) + "22",
                  color: moodColor(e.mood),
                }}
              >
                {e.mood_label} {e.mood}/10
              </span>
            )}
            <div className="entry-text">{e.text}</div>
          </div>
        ))}

        <button className="modal-close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
