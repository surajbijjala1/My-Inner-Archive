import { useState, useMemo, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Treemap,
} from "recharts";
import { moodColor } from "../utils";
import type { Entry } from "../types";

// ─── Shared constants ───────────────────────────────────────────────────────

const CHART_FONT = { fontFamily: "inherit", fontSize: 11 };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// ─── 1. Mood Area Chart (shadcn-styled) ─────────────────────────────────────

interface TimelinePoint {
  date: string;
  dateLabel: string;
  userMood: number;
  aiMood: number | null;
  userLabel: string;
  aiLabel: string;
  entryId: string;
  excerpt: string;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: TimelinePoint }[] }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{fmtDateFull(d.date)}</div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-dot" style={{ background: "#a07030" }} />
        You: {d.userLabel} ({d.userMood}/10)
      </div>
      {d.aiMood != null && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: "#6366f1" }} />
          AI: {d.aiLabel} ({d.aiMood}/10)
        </div>
      )}
      <div className="chart-tooltip-excerpt">{d.excerpt}</div>
    </div>
  );
}

function MoodAreaChart({ entries, onEntryClick }: { entries: Entry[]; onEntryClick: (id: string) => void }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const data = useMemo(() => {
    const scored = entries.filter((e) => e.mood != null || e.mood_user != null);
    return scored.slice(0, 30).reverse().map((e): TimelinePoint => ({
      date: e.created_at,
      dateLabel: fmtDate(e.created_at),
      userMood: e.mood_user ?? (e.mood as number),
      aiMood: e.mood,
      userLabel: e.mood_user_label ?? e.mood_label ?? "",
      aiLabel: e.mood_label ?? "",
      entryId: e.id,
      excerpt: e.text.length > 60 ? e.text.slice(0, 57) + "…" : e.text,
    }));
  }, [entries]);

  if (data.length < 2) return null;

  return (
    <div className="chart-section">
      <div className="chart-header">
        <div className="chart-title">Mood Timeline</div>
        <div className="chart-subtitle">Your inner state alongside how your words read</div>
      </div>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-line" style={{ background: "#a07030" }} /> Your rating
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-line chart-legend-line--dashed" style={{ background: "#6366f1" }} /> AI reading
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}
          onMouseMove={(state) => {
            // Recharts 3 reports activeTooltipIndex as a string
            const raw = (state as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex;
            const idx = raw == null || raw === "" ? NaN : Number(raw);
            setActiveIdx(Number.isInteger(idx) ? idx : null);
          }}
          onMouseLeave={() => setActiveIdx(null)}
          onClick={(state) => {
            const raw = (state as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex;
            const idx = raw == null || raw === "" ? activeIdx : Number(raw);
            if (idx != null && Number.isInteger(idx) && data[idx]) onEntryClick(data[idx].entryId);
          }}
          style={{ cursor: "pointer" }}>
          <defs>
            <linearGradient id="gradUser" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a07030" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#a07030" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradAI" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="dateLabel" tick={CHART_FONT} tickLine={false} axisLine={false}
            interval="preserveStartEnd" minTickGap={40} />
          <YAxis domain={[1, 10]} tick={CHART_FONT} tickLine={false} axisLine={false}
            ticks={[2, 5, 8]} width={36} />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border-medium)", strokeDasharray: "3 3" }} />
          <Area type="monotone" dataKey="aiMood" stroke="#6366f1" strokeWidth={1.5}
            strokeDasharray="5 3" fill="url(#gradAI)" dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }}
            activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} connectNulls
            isAnimationActive={false} />
          <Area type="monotone" dataKey="userMood" stroke="#a07030" strokeWidth={2}
            fill="url(#gradUser)" dot={{ r: 3.5, fill: "#a07030", strokeWidth: 0 }}
            activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="chart-hint">Click a point to jump to that entry</div>
    </div>
  );
}

// ─── 2. Tag Treemap ─────────────────────────────────────────────────────────

interface TreemapDatum {
  name: string;
  size: number;
  avgMood: number;
  color: string;
  [key: string]: string | number;
}

interface TreemapContentProps {
  x: number; y: number; width: number; height: number;
  name: string; color: string; size: number; avgMood: number;
}

function TreemapCell({ x, y, width, height, name, color, size, avgMood }: TreemapContentProps) {
  // Recharts also invokes content for the root node, which has no name/color
  if (!name || !color || width < 4 || height < 4) return null;
  const showLabel = width > 50 && height > 30;
  const showCount = width > 40 && height > 45;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={6}
        fill={color} fillOpacity={0.13} stroke={color} strokeOpacity={0.33} strokeWidth={1.5} />
      {showLabel && (
        <text x={x + width / 2} y={y + height / 2 - (showCount ? 6 : 0)}
          textAnchor="middle" dominantBaseline="central"
          fontSize={width > 90 ? 13 : 11} fontWeight={600} fill={color}>
          {name.length > Math.floor(width / 8) ? name.slice(0, Math.floor(width / 8) - 1) + "…" : name}
        </text>
      )}
      {showCount && (
        <text x={x + width / 2} y={y + height / 2 + 12}
          textAnchor="middle" dominantBaseline="central"
          fontSize={10} fill={color} fillOpacity={0.75}>
          {size} · {avgMood.toFixed(1)}
        </text>
      )}
    </g>
  );
}

function TagTreemap({ entries }: { entries: Entry[] }) {
  const data = useMemo((): TreemapDatum[] => {
    const map: Record<string, { count: number; moodSum: number; moodN: number }> = {};
    for (const e of entries) {
      const tag = e.activity || "Reflecting";
      if (!map[tag]) map[tag] = { count: 0, moodSum: 0, moodN: 0 };
      map[tag].count++;
      const s = e.mood_user ?? e.mood;
      if (s != null) { map[tag].moodSum += s; map[tag].moodN++; }
    }
    return Object.entries(map)
      .map(([name, d]) => {
        const avg = d.moodN > 0 ? d.moodSum / d.moodN : 5;
        return { name, size: d.count, avgMood: avg, color: moodColor(Math.round(avg)) };
      })
      .sort((a, b) => b.size - a.size);
  }, [entries]);

  if (data.length < 2) return null;

  return (
    <div className="chart-section">
      <div className="chart-header">
        <div className="chart-title">Where you write from</div>
        <div className="chart-subtitle">Size = entry count · Color = average mood</div>
      </div>
      <ResponsiveContainer width="100%" height={Math.min(280, 140 + data.length * 16)}>
        <Treemap data={data} dataKey="size" aspectRatio={4 / 3}
          content={<TreemapCell x={0} y={0} width={0} height={0} name="" color="" size={0} avgMood={0} />}
          isAnimationActive={false} />
      </ResponsiveContainer>
    </div>
  );
}

// ─── 3. Calendar Heatmap ────────────────────────────────────────────────────

function CalendarHeatmap({ entries, onEntryClick }: { entries: Entry[]; onEntryClick: (id: string) => void }) {
  const [hoveredDay, setHoveredDay] = useState<{ date: string; mood: number; count: number; x: number; y: number } | null>(null);

  const { weeks, monthLabels, dayMap } = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 6 * 30); // ~6 months back

    const map = new Map<string, { mood: number; count: number; entryId: string }>();
    for (const e of entries) {
      const key = e.created_at.slice(0, 10);
      const score = e.mood_user ?? e.mood ?? 5;
      const prev = map.get(key);
      if (!prev || score > prev.mood) {
        map.set(key, { mood: score, count: (prev?.count ?? 0) + 1, entryId: e.id });
      } else if (prev) {
        prev.count++;
      }
    }

    const weeks: { date: Date; key: string }[][] = [];
    const labels: { text: string; col: number }[] = [];
    let week: { date: Date; key: string }[] = [];
    const cur = new Date(start);
    cur.setDate(cur.getDate() - cur.getDay()); // back to Sunday
    let lastMonth = -1;

    while (cur <= today || week.length > 0) {
      const d = new Date(cur);
      const key = d.toISOString().slice(0, 10);
      week.push({ date: d, key });

      if (d.getMonth() !== lastMonth) {
        labels.push({
          text: d.toLocaleDateString(undefined, { month: "short" }),
          col: weeks.length,
        });
        lastMonth = d.getMonth();
      }

      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
      cur.setDate(cur.getDate() + 1);
      if (cur > today && week.length === 0) break;
    }
    if (week.length > 0) weeks.push(week);

    return { weeks, monthLabels: labels, dayMap: map };
  }, [entries]);

  const cellSize = 13;
  const gap = 2;
  const step = cellSize + gap;
  const headerH = 18;
  const dayLabelW = 20;

  return (
    <div className="chart-section">
      <div className="chart-header">
        <div className="chart-title">Writing Activity</div>
        <div className="chart-subtitle">Mood heatmap over the last 6 months</div>
      </div>
      <div style={{ overflowX: "auto", position: "relative" }}>
        <svg
          width={dayLabelW + weeks.length * step + 8}
          height={headerH + 7 * step + 8}
          style={{ display: "block" }}
        >
          {/* Month labels */}
          {monthLabels.map((m, i) => (
            <text key={i} x={dayLabelW + m.col * step} y={12}
              fontSize={10} fill="var(--text-muted)" style={CHART_FONT}>
              {m.text}
            </text>
          ))}

          {/* Day labels */}
          {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
            <text key={i} x={0} y={headerH + i * step + cellSize - 2}
              fontSize={9} fill="var(--text-muted)" style={CHART_FONT}>
              {d}
            </text>
          ))}

          {/* Cells */}
          {weeks.map((w, wi) =>
            w.map((day, di) => {
              const info = dayMap.get(day.key);
              const fill = info ? moodColor(info.mood) : "var(--bg-tertiary, #f0f0ee)";
              const opacity = info ? 0.7 + (info.mood / 10) * 0.3 : 0.4;
              return (
                <rect
                  key={day.key}
                  x={dayLabelW + wi * step}
                  y={headerH + di * step}
                  width={cellSize}
                  height={cellSize}
                  rx={2.5}
                  fill={fill}
                  opacity={opacity}
                  stroke={hoveredDay?.date === day.key ? "var(--text-primary)" : "none"}
                  strokeWidth={1.5}
                  style={{ cursor: info ? "pointer" : "default" }}
                  onMouseEnter={() => {
                    if (info) setHoveredDay({
                      date: day.key, mood: info.mood, count: info.count,
                      x: dayLabelW + wi * step, y: headerH + di * step,
                    });
                  }}
                  onMouseLeave={() => setHoveredDay(null)}
                  onClick={() => { if (info) onEntryClick(info.entryId); }}
                />
              );
            })
          )}
        </svg>

        {/* Tooltip */}
        {hoveredDay && (
          <div className="chart-tooltip" style={{
            position: "absolute",
            left: hoveredDay.x + cellSize + 8,
            top: hoveredDay.y - 10,
            pointerEvents: "none",
          }}>
            <div className="chart-tooltip-date">{fmtDateFull(hoveredDay.date + "T12:00:00")}</div>
            <div className="chart-tooltip-row">
              <span className="chart-tooltip-dot" style={{ background: moodColor(hoveredDay.mood) }} />
              Mood: {hoveredDay.mood}/10 · {hoveredDay.count} {hoveredDay.count === 1 ? "entry" : "entries"}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Low</span>
        {[1, 3, 5, 7, 10].map((v) => (
          <span key={v} className="heatmap-legend-cell" style={{ background: moodColor(v), opacity: 0.7 + (v / 10) * 0.3 }} />
        ))}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>High</span>
      </div>
    </div>
  );
}

// ─── 4. Mood legend ─────────────────────────────────────────────────────────

function MoodLegend() {
  return (
    <div className="chart-section" style={{ paddingBottom: 8 }}>
      <div className="mood-legend-compact">
        {([
          ["1–3", "Difficult", "#e05"],
          ["4–6", "Processing", "#eb3"],
          ["7–10", "Energized", "#2a4"],
        ] as const).map(([range, label, color]) => (
          <span key={range} className="mood-legend-compact-item">
            <span className="chart-tooltip-dot" style={{ background: color }} />
            <strong>{range}</strong> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────────

interface MoodGraphProps {
  entries: Entry[];
  onScrollToEntry?: (id: string) => void;
}

export default function MoodGraph({ entries, onScrollToEntry }: MoodGraphProps) {
  const scored = entries.filter((e) => e.mood != null || e.mood_user != null);

  const handleEntryClick = useCallback((id: string) => {
    onScrollToEntry?.(id);
  }, [onScrollToEntry]);

  if (scored.length < 1) {
    return (
      <div className="mood-empty">
        Save your first entry to start your mood timeline
      </div>
    );
  }

  return (
    <div className="charts-container">
      <MoodAreaChart entries={entries} onEntryClick={handleEntryClick} />
      <MoodLegend />
      {entries.length >= 3 && <TagTreemap entries={entries} />}
      <CalendarHeatmap entries={entries} onEntryClick={handleEntryClick} />
    </div>
  );
}
