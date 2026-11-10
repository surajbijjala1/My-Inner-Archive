import { useEffect, useState } from "react";
import MdText from "./MdText";
import { getPatterns } from "../api";
import type { Patterns as PatternsData } from "../types";

interface PatternsProps {
  /** Opening a day from the heatmap takes you back to the journal. */
  onOpenDay?: (date: string) => void;
}

/** Roughly six months, and then a year at a time going back. */
const WINDOWS: { label: string; days: number }[] = [
  { label: "six months", days: 182 },
  { label: "a year", days: 365 },
  { label: "all of it", days: 366 * 5 },
];

/**
 * How much of a long reflection the page opens with. Measured in characters
 * rather than paragraphs, because these summaries arrive as anything from
 * three short lines to a multi-section analysis.
 */
const OPENING_CHARS = 420;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Ink gets darker the more you wrote that day; an empty day stays faint. */
function cellTone(count: number, busiest: number): string {
  if (count === 0) return "oklch(0.915 0.008 78)";
  const strength = busiest <= 1 ? 1 : Math.min(count / busiest, 1);
  const alpha = 0.22 + strength * 0.6;
  return `oklch(0.78 0.09 80 / ${alpha.toFixed(2)})`;
}

/**
 * A weekly reflection arrives as prose. The design sets it as a few short
 * paragraphs, so split on blank lines where the model gave them and fall
 * back to grouping sentences when it gave one block.
 */
function paragraphsOf(summary: string): string[] {
  const byBlank = summary
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;

  const single = byBlank[0] ?? summary.trim();
  const sentences = single.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!sentences || sentences.length <= 2) return [single];

  // Two sentences to a paragraph keeps the measure the design draws.
  const grouped: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    grouped.push(sentences.slice(i, i + 2).join("").trim());
  }
  return grouped;
}

/**
 * A "YYYY-MM-DD" day key as a local calendar date. `new Date("2026-11-08")` is
 * midnight UTC, which is still Nov 7 anywhere west of UTC, so the mood line's
 * axis read a day early. The server already groups days in the user's zone.
 */
function calendarDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Every day in the window, so gaps stay visible as gaps. */
function buildDays(windowDays: number, counts: Map<string, number>) {
  const days: { date: string; count: number; d: Date }[] = [];
  const today = new Date();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    days.push({ date: key, count: counts.get(key) ?? 0, d });
  }
  return days;
}

/**
 * What's been true lately. The page reads top to bottom: how often you wrote,
 * the reflections already written for you, how you felt, and where you write
 * from. "How you sounded" is designed but has no data yet, so it is absent
 * rather than faked.
 */
export default function Patterns({ onOpenDay }: PatternsProps) {
  const [days, setDays] = useState(WINDOWS[0].days);
  // One piece of state so the fetch never has to set three in a row.
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; data: PatternsData } | { status: "failed" }
  >({ status: "loading" });
  // Bumped to ask for the same window again after a failure.
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPatterns(days)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [days, attempt]);

  if (state.status === "loading") {
    return <div className="patterns-aside">looking back&hellip;</div>;
  }

  if (state.status === "failed") {
    return (
      <div className="patterns-aside">
        couldn't read the patterns just now.{" "}
        <button
          className="patterns-retry"
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          try again
        </button>
      </div>
    );
  }

  const data = state.data;

  const counts = new Map(data.heatmap.map((h) => [h.date, h.count]));
  const cells = buildDays(data.windowDays, counts);
  const busiest = Math.max(1, ...data.heatmap.map((h) => h.count));
  const wroteAtAll = data.heatmap.length > 0;

  // One label per month, placed at the first cell that falls in it.
  const monthMarks: { index: number; label: string }[] = [];
  cells.forEach((cell, i) => {
    const previous = cells[i - 1];
    if (!previous || previous.d.getMonth() !== cell.d.getMonth()) {
      monthMarks.push({ index: i, label: MONTHS[cell.d.getMonth()] });
    }
  });

  // The design shows the most recent reflection only — earlier weeks are
  // history, not the page. Showing all four reads as one long run-on.
  const latest = data.summaries[0] ?? null;
  // These reflections can run long. The design shows a few short paragraphs,
  // so the opening is shown and the remainder is offered rather than dumped.
  const paras = latest ? paragraphsOf(latest.summary) : [];
  const opening: string[] = [];
  let run = 0;
  for (const para of paras) {
    if (opening.length > 0 && run >= OPENING_CHARS) break;
    opening.push(para);
    run += para.length;
  }
  const rest = opening.length < paras.length;
  const shown = (expanded ? paras : opening).join("\n\n");

  return (
    <div className="patterns">
      <div className="patterns-windows">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            className={`patterns-window ${w.days === days ? "patterns-window--on" : ""}`}
            onClick={() => {
              if (w.days === days) return;
              setState({ status: "loading" });
              setDays(w.days);
            }}
          >
            {w.label}
          </button>
        ))}
      </div>

      {!wroteAtAll ? (
        <div className="patterns-aside">
          nothing to look back on yet — the shape shows up after a few entries
        </div>
      ) : (
        <>
          <div className="heat">
            <div className="heat-grid">
              {cells.map((cell) => (
                <button
                  key={cell.date}
                  className="heat-cell"
                  style={{ background: cellTone(cell.count, busiest) }}
                  aria-label={`${cell.date}: ${cell.count} ${
                    cell.count === 1 ? "entry" : "entries"
                  }`}
                  title={`${cell.date} · ${cell.count}`}
                  disabled={cell.count === 0}
                  onClick={() => onOpenDay?.(cell.date)}
                />
              ))}
            </div>
            <div className="heat-months">
              {monthMarks.map((m) => (
                <span
                  key={`${m.label}-${m.index}`}
                  className="heat-month"
                  style={{ gridColumn: Math.floor(m.index / 7) + 1 }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {latest && (
            <section className="patterns-section">
              <h3 className="patterns-label">what's been true lately</h3>
              <div className="patterns-prose">
                <MdText text={shown} />
              </div>
              {rest && (
                <button
                  className="patterns-more"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? "that's enough" : "the rest of it"}
                </button>
              )}
              <div className="patterns-written">
                written{" "}
                {new Date(latest.writtenAt).toLocaleDateString(undefined, { weekday: "long" })}
              </div>
            </section>
          )}

          {data.mood.length > 0 && (
            <section className="patterns-section">
              <h3 className="patterns-label">how you felt</h3>
              <MoodLine points={data.mood} />
            </section>
          )}

          {data.tags.length > 0 && (
            <section className="patterns-section">
              <h3 className="patterns-label">where you write from</h3>
              <TagMap tags={data.tags} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Where you write from, as blocks whose area is how often — the design's
 * own treatment. Laid out by squarified treemap so the shapes stay close
 * to square instead of turning into slivers, and coloured by share: the
 * places you return to most are the warmest and darkest.
 */
function TagMap({ tags }: { tags: { label: string; count: number }[] }) {
  // More than eight blocks stops being readable at phone width.
  const shown = [...tags].sort((a, b) => b.count - a.count).slice(0, 8);
  const total = shown.reduce((sum, t) => sum + t.count, 0);
  if (total === 0) return null;

  const blocks = squarify(
    shown.map((t) => ({ ...t, value: t.count / total })),
    { x: 0, y: 0, w: 100, h: 100 }
  );

  // Colour by rank rather than raw share: real tag counts cluster together,
  // and dividing by the largest would leave every block the same brown.
  const rank = new Map(
    [...shown]
      .sort((a, b) => a.count - b.count)
      .map((t, i) => [t.label, shown.length === 1 ? 1 : i / (shown.length - 1)])
  );

  return (
    <div className="tagmap">
      {blocks.map((b) => {
        const heat = rank.get(b.label) ?? 0;
        // Warmer and darker the more you write from there.
        const lightness = 0.915 - heat * 0.245;
        const chroma = 0.028 + heat * 0.047;
        const hue = 78 - heat * 32;
        const dark = lightness < 0.76;
        // A label only fits where there is room for it.
        const roomy = b.w > 22 && b.h > 18;
        return (
          <div
            key={b.label}
            className="tagmap-block"
            style={{
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.w}%`,
              height: `${b.h}%`,
              background: `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(0)})`,
            }}
            title={`${b.label} · ${b.count}`}
          >
            {roomy && (
              <span
                className="tagmap-label"
                style={{
                  color: dark ? "oklch(0.96 0.02 82)" : "oklch(0.38 0.035 50)",
                  fontSize: b.h > 28 && b.w > 34 ? "var(--font-size-xl)" : "var(--font-size-base)",
                }}
              >
                {b.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type Tile = { label: string; count: number; value: number };
type Rect = { x: number; y: number; w: number; h: number };
type Placed = Tile & Rect;

/** Squarified treemap (Bruls, Huizing & van Wijk), in percentage units. */
function squarify(tiles: Tile[], area: Rect): Placed[] {
  const placed: Placed[] = [];
  let rect = { ...area };
  let remaining = [...tiles];
  let remainingValue = remaining.reduce((sum, t) => sum + t.value, 0);

  while (remaining.length > 0) {
    const horizontal = rect.w >= rect.h;
    const side = horizontal ? rect.h : rect.w;

    // Grow the row while the worst aspect ratio keeps improving.
    let row: Tile[] = [];
    let rowValue = 0;
    let best = Infinity;

    for (const tile of remaining) {
      const nextValue = rowValue + tile.value;
      const depth = (nextValue / remainingValue) * (horizontal ? rect.w : rect.h);
      const next = [...row, tile];
      const worst = Math.max(
        ...next.map((t) => {
          const length = (t.value / nextValue) * side;
          return Math.max(length / depth, depth / length);
        })
      );
      if (worst > best) break;
      best = worst;
      row = next;
      rowValue = nextValue;
    }

    const depth = (rowValue / remainingValue) * (horizontal ? rect.w : rect.h);
    let offset = horizontal ? rect.y : rect.x;

    for (const tile of row) {
      const length = (tile.value / rowValue) * side;
      placed.push(
        horizontal
          ? { ...tile, x: rect.x, y: offset, w: depth, h: length }
          : { ...tile, x: offset, y: rect.y, w: length, h: depth }
      );
      offset += length;
    }

    if (horizontal) {
      rect = { x: rect.x + depth, y: rect.y, w: rect.w - depth, h: rect.h };
    } else {
      rect = { x: rect.x, y: rect.y + depth, w: rect.w, h: rect.h - depth };
    }
    remaining = remaining.slice(row.length);
    remainingValue -= rowValue;
  }

  return placed;
}

/** A single run of how you felt, drawn rather than charted. */
function MoodLine({ points }: { points: { date: string; score: number; own: boolean }[] }) {
  const W = 334;
  const H = 104;
  const MID = 55;
  /** A week without an entry breaks the run rather than drawing through it. */
  const GAP_DAYS = 7;

  if (points.length < 2) {
    return <div className="patterns-aside">not enough yet to draw a line</div>;
  }

  const start = +calendarDate(points[0].date);
  const end = +calendarDate(points[points.length - 1].date);
  const span = Math.max(end - start, 1);
  const x = (iso: string) => ((+calendarDate(iso) - start) / span) * W;
  const y = (score: number) => H - ((score - 1) / 9) * H;

  // Split into runs wherever you stopped writing for a while.
  const runs: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    const previous = points[i - 1];
    const gapped =
      previous && (+calendarDate(p.date) - +calendarDate(previous.date)) / 86400000 > GAP_DAYS;
    if (gapped && current.length) {
      runs.push(current.join(" "));
      current = [];
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x(p.date).toFixed(1)},${y(p.score).toFixed(1)}`);
  });
  if (current.length) runs.push(current.join(" "));

  const when = (iso: string) =>
    calendarDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const middle = points[Math.floor(points.length / 2)].date;

  return (
    <div className="mood-line">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mood-line-svg"
        role="img" aria-label="How you felt over this period">
        <line x1="0" y1={MID} x2={W} y2={MID} stroke="oklch(0.855 0.012 70)" strokeWidth="1"
          vectorEffect="non-scaling-stroke" />
        {runs.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="oklch(0.58 0.055 52)" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mood-line-ends">
        <span>{when(points[0].date)}</span>
        <span>{when(middle)}</span>
        <span>{when(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}
