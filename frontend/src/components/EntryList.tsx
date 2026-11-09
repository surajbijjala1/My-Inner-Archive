import { useState, useEffect, useRef } from "react";
import { getEntryMood, setEntryFavorite } from "../api";
import { formatEntryTime, formatDayHeading, groupByDay, tagLabel } from "../utils";
import type { Entry, EntryMood } from "../types";

interface EntryListProps {
  entries: Entry[];
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  /** Entry to scroll to and highlight (notification deep link). */
  highlightId?: string | null;
}

/**
 * The journal is a page, not a list: entries fall down the day in a time
 * gutter, each with a handwritten margin note. Holding an entry lifts it
 * out of the page — everything else recedes and the one option is to tear
 * it out. That is the only way to delete, as drawn.
 */
export default function EntryList({
  entries,
  onDelete,
  onUpdateEntry,
  onToggleFavorite,
  highlightId,
}: EntryListProps) {
  const [heldId, setHeldId] = useState<string | null>(null);

  // A hold is released by letting go anywhere, not just on the entry.
  useEffect(() => {
    if (!heldId) return;
    const release = () => setHeldId(null);
    window.addEventListener("pointerdown", release);
    window.addEventListener("keydown", release);
    return () => {
      window.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", release);
    };
  }, [heldId]);

  if (entries.length === 0) {
    return <div className="entry-empty">nothing here yet — start anywhere</div>;
  }

  return (
    <div className={`journal ${heldId ? "journal--holding" : ""}`}>
      {groupByDay(entries).map(([dayIso, dayEntries]) => (
        <section className="journal-day" key={dayIso}>
          <h2 className="journal-date">{formatDayHeading(dayIso)}</h2>
          {dayEntries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              held={e.id === heldId}
              onHold={() => setHeldId(e.id)}
              onRelease={() => setHeldId(null)}
              onDelete={onDelete}
              onUpdateEntry={onUpdateEntry}
              onToggleFavorite={onToggleFavorite}
              highlighted={e.id === highlightId}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface EntryRowProps {
  entry: Entry;
  held: boolean;
  onHold: () => void;
  onRelease: () => void;
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  highlighted: boolean;
}

const HOLD_MS = 450;

function EntryRow({
  entry: e,
  held,
  onHold,
  onRelease,
  onDelete,
  onUpdateEntry,
  onToggleFavorite,
  highlighted,
}: EntryRowProps) {
  const [polling, setPolling] = useState(e.mood == null);
  const retries = useRef(0);
  const [togglingFav, setTogglingFav] = useState(false);
  const [favError, setFavError] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notification deep link: scroll to the referenced entry.
  useEffect(() => {
    if (highlighted) {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  useEffect(() => {
    if (!polling || e.mood != null) return;

    const timer = setInterval(async () => {
      retries.current += 1;
      try {
        const data = await getEntryMood(e.id);
        if (data && data.mood != null) {
          onUpdateEntry(e.id, data);
          setPolling(false);
        }
      } catch {
        // Scoring is fire-and-forget; a failed poll just tries again.
      }
      if (retries.current >= 10) setPolling(false); // give up after ~30s
    }, 3000);

    return () => clearInterval(timer);
  }, [polling, e.mood, e.id, onUpdateEntry]);

  const toggleFavorite = async () => {
    if (togglingFav) return;
    setTogglingFav(true);
    setFavError(false);
    try {
      const result = await setEntryFavorite(e.id, !e.is_favorite);
      onToggleFavorite(e.id, result.is_favorite);
    } catch {
      setFavError(true);
    }
    setTogglingFav(false);
  };

  const startHold = () => {
    holdTimer.current = setTimeout(onHold, HOLD_MS);
  };
  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => cancelHold, []);

  // The margin note says where you were and how it felt, in that order.
  const moodWord = e.mood_user_label || e.mood_label;
  // Derived rather than stored: the score may also arrive with a prop update.
  const waitingOnMood = polling && e.mood == null;

  return (
    <div
      id={`entry-${e.id}`}
      ref={rowRef}
      className={`entry-row ${held ? "entry-row--held" : ""} ${
        highlighted ? "entry-row--highlighted" : ""
      }`}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(ev) => {
        // Long-press on touch fires the context menu; that is the same gesture.
        ev.preventDefault();
        onHold();
      }}
    >
      <div className="entry-time">{formatEntryTime(e.created_at)}</div>
      <div className="entry-body">
        <p className="entry-text">{e.text}</p>

        <div className="entry-margin">
          {e.activity && <span>{tagLabel(e.activity)}</span>}
          {e.activity && moodWord && <span aria-hidden="true"> &middot; </span>}
          {moodWord && <span>{moodWord}</span>}
          {waitingOnMood && !moodWord && <span className="entry-margin--waiting">reading it&hellip;</span>}
          <button
            className={`entry-star ${e.is_favorite ? "entry-star--on" : ""}`}
            onClick={toggleFavorite}
            disabled={togglingFav}
            aria-pressed={!!e.is_favorite}
            title={
              e.is_favorite
                ? "Remove from your daily notifications"
                : "Star — may resurface in your daily notifications"
            }
          >
            {e.is_favorite ? "★" : "☆"}
          </button>
        </div>

        {favError && <div className="entry-margin entry-margin--error">didn't save — try again</div>}

        {held && (
          <div className="entry-tear">
            <button
              className="entry-tear-btn"
              onClick={() => {
                onRelease();
                onDelete(e.id);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="12" x2="18" y2="12" />
              </svg>
              <span>tear out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
