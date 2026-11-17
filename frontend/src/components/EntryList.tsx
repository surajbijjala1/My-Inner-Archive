import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { getEntryMood, setEntryFavorite } from "../api";
import { formatEntryTime, formatDayHeading, groupByDay, tagLabel } from "../utils";
import type { Entry, EntryMood } from "../types";
import type { Tearing } from "../hooks/useJournal";
import { prefersReducedMotion, TEAR_CLOSE_MS, TEAR_RIP_MS, tornEdge } from "../motion";

// The torn piece is two layers of one ragged shape: the paper, and a paler
// fringe of fibre showing round it.
const TORN_FIBRE = tornEdge(0);
const TORN_PAPER = tornEdge(2);
const TEAR_VARS = {
  "--torn-fibre": TORN_FIBRE,
  "--torn-paper": TORN_PAPER,
  "--tear-ms": `${TEAR_RIP_MS}ms`,
} as CSSProperties;

/** Where each day and each entry sits, so the gap can be closed by sliding. */
type Positions = Map<string, number>;

function measure(root: HTMLElement): Positions {
  const out: Positions = new Map();
  const rootTop = root.getBoundingClientRect().top;
  root.querySelectorAll<HTMLElement>(".journal-day").forEach((day) => {
    const dayTop = day.getBoundingClientRect().top;
    out.set(day.dataset.flip ?? "", dayTop - rootTop);
    // Entries are measured against their own day, so a day that moves
    // doesn't move its entries a second time.
    day.querySelectorAll<HTMLElement>(".entry-row").forEach((row) => {
      out.set(row.id, row.getBoundingClientRect().top - dayTop);
    });
  });
  return out;
}

interface EntryListProps {
  entries: Entry[];
  onDelete: (id: string) => void;
  onUpdateEntry: (id: string, moodData: EntryMood) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  /** Entry to scroll to and highlight (notification deep link). */
  highlightId?: string | null;
  /** The entry being torn out, and how far along it is. */
  tearing?: Tearing | null;
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
  tearing,
}: EntryListProps) {
  const [heldId, setHeldId] = useState<string | null>(null);
  const journalRef = useRef<HTMLDivElement | null>(null);
  const before = useRef<Positions | null>(null);

  // Closing the gap, without animating layout: note where everything is as
  // the rip starts, and once the torn entry has left the list, slide each
  // thing from where it was to where it now is (transform only).
  const ripping = tearing?.phase === "ripping" ? tearing.id : null;
  useLayoutEffect(() => {
    if (ripping && journalRef.current) before.current = measure(journalRef.current);
  }, [ripping]);

  useLayoutEffect(() => {
    const was = before.current;
    const root = journalRef.current;
    if (!was || !root || ripping) return;
    before.current = null;
    if (prefersReducedMotion()) return;
    const viewport = window.innerHeight;
    measure(root).forEach((top, key) => {
      const old = was.get(key);
      if (old === undefined || Math.abs(old - top) < 1) return;
      // Looked up inside this copy of the journal: the page is drawn twice
      // (wide and narrow), so an id alone would find the other copy.
      const el = root.querySelector<HTMLElement>(
        key.startsWith("entry-") ? `#${CSS.escape(key)}` : `[data-flip="${CSS.escape(key)}"]`
      );
      if (!el) return;
      // Only what can be seen needs to move.
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -viewport || rect.top > viewport * 2) return;
      el.animate(
        [{ transform: `translateY(${old - top}px)` }, { transform: "translateY(0)" }],
        { duration: TEAR_CLOSE_MS, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)" }
      );
    });
  }, [entries, ripping]);

  // A hold is released by pressing anywhere else on the page. NOT on the
  // tear-out control itself: that press used to release the hold first, so
  // React removed the button before its click could land, and tearing out an
  // entry was impossible.
  useEffect(() => {
    if (!heldId) return;
    const release = (ev: Event) => {
      if (ev.target instanceof Element && ev.target.closest(".entry-tear")) return;
      setHeldId(null);
    };
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
    <div className={`journal ${heldId ? "journal--holding" : ""}`} ref={journalRef}>
      {groupByDay(entries).map(([dayIso, dayEntries]) => (
        <section className="journal-day" key={dayIso} data-flip={`day-${dayIso}`}>
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
              tearPhase={tearing?.id === e.id ? tearing.phase : null}
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
  tearPhase: Tearing["phase"] | null;
}

const HOLD_MS = 450;

/** How long to keep polling for an AI mood score. Covers the server's own
 *  retry window (backend/src/routes/entries.ts: up to ~3 minutes). */
const SCORE_POLL_LIMIT_MS = 5 * 60_000;

function EntryRow({
  entry: e,
  held,
  onHold,
  onRelease,
  onDelete,
  onUpdateEntry,
  onToggleFavorite,
  highlighted,
  tearPhase,
}: EntryRowProps) {
  // "Scoring" is derived, not stored: it ends by itself when the score
  // arrives. Only giving up needs state.
  const [gaveUp, setGaveUp] = useState(false);
  const scoring = e.mood == null && !gaveUp;
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
  const waitingOnMood = scoring;

  return (
    <div
      id={`entry-${e.id}`}
      ref={rowRef}
      className={`entry-row ${held ? "entry-row--held" : ""} ${
        highlighted ? "entry-row--highlighted" : ""
      } ${tearPhase ? `entry-row--${tearPhase}` : ""}`}
      style={tearPhase ? TEAR_VARS : undefined}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(ev) => {
        // Long-press on touch fires the context menu; that is the same gesture.
        ev.preventDefault();
        onHold();
      }}
    >
      {tearPhase === "ripping" && <TornStub />}
      <div className="entry-sheet">
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
          // Pressing the control mustn't start a new long-press on the row.
          <div className="entry-tear" onPointerDown={(ev) => ev.stopPropagation()}>
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
    </div>
  );
}

/**
 * What the page keeps where an entry was torn from it: a ragged line of pale
 * fibre, with the faintest shadow under it. Drawn, and gone as the gap closes.
 */
function TornStub() {
  return (
    <svg className="entry-stub" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true">
      <path
        className="entry-stub-shade"
        d="M0 7 L14 4.5 L26 8 L41 5 L58 8.5 L70 5.5 L88 9 L103 6 L119 8 L137 4.5 L150 7.5 L168 5 L183 9 L201 6 L214 8 L233 5 L247 8.5 L262 5.5 L281 9 L296 6.5 L312 8 L330 5 L344 8.5 L361 6 L378 8 L400 5.5"
      />
      <path
        className="entry-stub-fibre"
        d="M0 5 L14 2.5 L26 6 L41 3 L58 6.5 L70 3.5 L88 7 L103 4 L119 6 L137 2.5 L150 5.5 L168 3 L183 7 L201 4 L214 6 L233 3 L247 6.5 L262 3.5 L281 7 L296 4.5 L312 6 L330 3 L344 6.5 L361 4 L378 6 L400 3.5"
      />
    </svg>
  );
}
