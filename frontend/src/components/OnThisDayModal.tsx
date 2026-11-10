import { tagLabel } from "../utils";
import type { Entry } from "../types";

interface OnThisDayModalProps {
  entries: Entry[];
  onClose: () => void;
}

/** "a year ago", "3 years ago" — counted in calendar years from today. */
function yearsAgo(iso: string): string {
  const n = new Date().getFullYear() - new Date(iso).getFullYear();
  return n <= 1 ? "a year ago" : `${n} years ago`;
}

/**
 * What you wrote on this date in earlier years. Laid out like the journal
 * itself — your words in the reading font, the tag and mood in the margin —
 * rather than as cards, so it reads as a page from your own archive.
 */
export default function OnThisDayModal({ entries, onClose }: OnThisDayModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="otd-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <div className="sheet-head">
          <div className="modal-title" id="otd-title">On this day</div>
          <button className="sheet-back" onClick={onClose}>done</button>
        </div>

        <ul className="sheet-list">
          {entries.map((e) => {
            const moodWord = e.mood_user_label || e.mood_label;
            const when = new Date(e.created_at).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            });
            return (
              <li key={e.id} className="otd-item">
                <div className="otd-when">
                  {yearsAgo(e.created_at)} <span aria-hidden="true">&middot;</span> {when}
                </div>
                <p className="entry-text">{e.text}</p>
                {(e.activity || moodWord) && (
                  <div className="entry-margin">
                    {e.activity && <span>{tagLabel(e.activity)}</span>}
                    {e.activity && moodWord && <span aria-hidden="true"> &middot; </span>}
                    {moodWord && <span>{moodWord}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
