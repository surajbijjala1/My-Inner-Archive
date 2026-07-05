import { useState } from "react";
import { pack, hierarchy } from "d3-hierarchy";
import type { HierarchyCircularNode } from "d3-hierarchy";
import { moodColor } from "../utils";
import type { Entry } from "../types";

// ─── Bubble chart helpers ────────────────────────────────────────────────────

interface BubbleDatum {
  tag: string;
  count: number;
  moodSum: number;
  moodCount: number;
  avgMood: number;
}

// d3 hierarchy root wraps the data in { children: [...] }
type BubbleNode = BubbleDatum | { children: BubbleDatum[] };

function buildBubbleData(entries: Entry[]): BubbleDatum[] {
  const map: Record<string, Omit<BubbleDatum, "avgMood">> = {};
  for (const e of entries) {
    const tag = e.activity || "🪞 Reflecting";
    if (!map[tag]) map[tag] = { tag, count: 0, moodSum: 0, moodCount: 0 };
    map[tag].count += 1;
    const score = e.mood_user ?? e.mood;
    if (score) {
      map[tag].moodSum += score;
      map[tag].moodCount += 1;
    }
  }
  return Object.values(map)
    .map((d) => ({ ...d, avgMood: d.moodCount > 0 ? d.moodSum / d.moodCount : 5 }))
    .sort((a, b) => b.count - a.count);
}

function BubbleChart({ entries }: { entries: Entry[] }) {
  const [selected, setSelected] = useState<string | null>(null); // clicked bubble tag
  const data = buildBubbleData(entries);
  if (data.length < 2) return null;

  // Dynamic sizing — more bubbles = taller chart
  const W = 340;
  const H = Math.max(240, Math.min(380, 160 + data.length * 22));
  const root = hierarchy<BubbleNode>({ children: data }).sum((d) => ("count" in d ? d.count : 0));
  const packed = pack<BubbleNode>().size([W - 20, H - 20]).padding(6)(root);
  const leaves = packed.leaves() as HierarchyCircularNode<BubbleDatum>[];

  // Find the selected leaf for tooltip positioning
  const selectedLeaf = selected ? leaves.find((l) => l.data.tag === selected) : null;

  const handleClick = (tag: string) => {
    setSelected((prev) => (prev === tag ? null : tag));
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div className="section-label">Where your best thoughts come from</div>
      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 14 }}>
        Bubble size = entry count · Color = average mood · Tap a bubble for details
      </div>

      {/* Rectangular jar container */}
      <div
        className="bubble-jar"
        onClick={(e) => {
          // Dismiss tooltip if clicking the background
          const target = e.target as HTMLElement;
          if (target === e.currentTarget || target.closest(".bubble-jar-inner")) {
            setSelected(null);
          }
        }}
      >
        <div className="bubble-jar-inner" style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="bubble-svg"
            style={{ display: "block", width: "100%" }}
          >
            {leaves.map((leaf, i) => {
              const d = leaf.data;
              const color = moodColor(Math.round(d.avgMood));
              const isSelected = selected === d.tag;
              const floatDur = (2.5 + Math.random() * 1.5).toFixed(2);
              const floatDelay = (Math.random() * 2).toFixed(2);
              // Offset by padding so bubbles sit inside the jar
              const cx = leaf.x + 10;
              const cy = leaf.y + 10;

              return (
                <g
                  key={d.tag}
                  className="bubble-group"
                  style={{ animationDelay: `${i * 80}ms`, cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); handleClick(d.tag); }}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={leaf.r}
                    fill="#fff"
                    stroke={color}
                    strokeWidth={isSelected ? "3.5" : "2.5"}
                    className="bubble-circle"
                    style={{
                      "--float-dur": `${floatDur}s`,
                      "--float-delay": `${floatDelay}s`,
                      filter: isSelected
                        ? `drop-shadow(0 4px 14px ${color}50)`
                        : `drop-shadow(0 2px 6px ${color}20)`,
                      transform: isSelected ? "scale(1.06)" : "scale(1)",
                      transformOrigin: `${cx}px ${cy}px`,
                      transition: "transform 0.2s ease, filter 0.2s ease, stroke-width 0.2s",
                    } as React.CSSProperties}
                  />
                  <text
                    x={cx}
                    y={cy - (leaf.r > 35 ? 5 : 2)}
                    textAnchor="middle"
                    fontSize={leaf.r > 45 ? 12 : leaf.r > 30 ? 10 : 8}
                    fontWeight="600"
                    fill={color}
                    className="bubble-text"
                    style={{ "--float-dur": `${floatDur}s`, "--float-delay": `${floatDelay}s`, pointerEvents: "none" } as React.CSSProperties}
                  >
                    {d.tag.length > 14 ? d.tag.slice(0, 12) + "…" : d.tag}
                  </text>
                  <text
                    x={cx}
                    y={cy + (leaf.r > 35 ? 12 : 9)}
                    textAnchor="middle"
                    fontSize="10"
                    fill={color + "cc"}
                    className="bubble-text"
                    style={{ "--float-dur": `${floatDur}s`, "--float-delay": `${floatDelay}s`, pointerEvents: "none" } as React.CSSProperties}
                  >
                    ×{d.count}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Tooltip overlay — rendered as HTML on top of SVG, always in foreground */}
          {selectedLeaf && (() => {
            const d = selectedLeaf.data;
            const color = moodColor(Math.round(d.avgMood));
            // Convert SVG coords to percentage positions within the container
            const leftPct = ((selectedLeaf.x + 10) / W) * 100;
            const topPct = ((selectedLeaf.y + 10) / H) * 100;
            const showBelow = topPct < 30;

            return (
              <div
                className="bubble-info-card"
                style={{
                  left: `${leftPct}%`,
                  top: showBelow ? `calc(${topPct}% + ${selectedLeaf.r + 8}px)` : `calc(${topPct}% - ${selectedLeaf.r + 8}px)`,
                  transform: showBelow ? "translateX(-50%)" : "translateX(-50%) translateY(-100%)",
                  borderColor: color,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: 3 }}>{d.tag}</div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  {d.count} {d.count === 1 ? "entry" : "entries"}
                </div>
                <div style={{ fontSize: "12px", color }}>
                  Avg mood: {d.avgMood.toFixed(1)}/10
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MoodGraph({ entries }: { entries: Entry[] }) {
  // Need at least 1 scored entry to show anything
  const aiScored = entries.filter((e) => e.mood != null);

  if (aiScored.length < 1) {
    return (
      <div className="mood-empty">
        Save your first entry to start your mood timeline ✨
      </div>
    );
  }

  // Build graph data from up to 30 newest scored entries
  const graphEntries = aiScored.slice(0, 30).reverse();
  const W = 440, H = 120, pad = 28;
  const n = graphEntries.length;

  const xs = graphEntries.map((_, i) => pad + (n > 1 ? (i / (n - 1)) * (W - pad * 2) : (W - pad * 2) / 2));

  // AI line (mood — what the text sounds like)
  const ysAI = graphEntries.map((e) => H - pad - (((e.mood as number) - 1) / 9) * (H - pad * 2));
  const pathAI = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ysAI[i]}`).join(" ");
  const areaAI =
    `M${xs[0]},${H - 6} ` +
    xs.map((x, i) => `L${x},${ysAI[i]}`).join(" ") +
    ` L${xs[xs.length - 1]},${H - 6} Z`;

  // User line (mood_user — how they actually felt)
  const ysUser = graphEntries.map((e) =>
    H - pad - (((e.mood_user ?? (e.mood as number)) - 1) / 9) * (H - pad * 2)
  );
  const pathUser = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ysUser[i]}`).join(" ");

  return (
    <div>
      <div className="panel-title">Mood Timeline</div>
      <div className="panel-sub">Your inner state alongside how your words read</div>

      {/* Legend */}
      <div className="mood-dual-legend">
        <span className="mood-legend-line mood-legend-line--user">— Your rating</span>
        <span className="mood-legend-line mood-legend-line--ai">— AI reading</span>
      </div>

      {/* Dual line graph */}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="mgAI" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* AI area fill (subtle) */}
        <path d={areaAI} fill="url(#mgAI)" />

        {/* AI line — indigo */}
        <path d={pathAI} fill="none" stroke="#6366f1" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 3" />

        {/* User line — warm amber */}
        <path d={pathUser} fill="none" stroke="#a07030" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots — AI (small) */}
        {graphEntries.map((e, i) => (
          <circle key={`ai-${i}`} cx={xs[i]} cy={ysAI[i]} r="3.5"
            fill={moodColor(e.mood as number)} stroke="#fff" strokeWidth="1.2">
            <title>
              {new Date(e.created_at).toLocaleDateString()} · AI: {e.mood_label} ({e.mood}/10)
            </title>
          </circle>
        ))}

        {/* Dots — User (slightly larger) */}
        {graphEntries.map((e, i) => {
          const score = e.mood_user ?? (e.mood as number);
          const label = e.mood_user_label ?? e.mood_label;
          const isUserSet = e.mood_user != null;
          return (
            <circle key={`user-${i}`} cx={xs[i]} cy={ysUser[i]} r={isUserSet ? 5 : 3.5}
              fill={moodColor(score)} stroke="#fff" strokeWidth="1.5"
              opacity={isUserSet ? 1 : 0.5}>
              <title>
                {new Date(e.created_at).toLocaleDateString()} · {isUserSet ? "You" : "AI default"}: {label} ({score}/10)
              </title>
            </circle>
          );
        })}

        {/* Y-axis labels */}
        {[2, 5, 8].map((v) => (
          <text key={v} x={pad - 8}
            y={H - pad - ((v - 1) / 9) * (H - pad * 2) + 4}
            fontSize="9" fill="#ccc" textAnchor="end">
            {v}
          </text>
        ))}
      </svg>

      {/* Date range */}
      <div className="mood-dates">
        <span className="mood-date-label">
          {new Date(graphEntries[0].created_at).toLocaleDateString()}
        </span>
        <span className="mood-date-label">
          {new Date(graphEntries[graphEntries.length - 1].created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Mood legend */}
      <div style={{ marginTop: 20 }}>
        <div className="section-label">Mood legend</div>
        <div className="mood-legend">
          {([
            ["1–3", "Low / difficult", "#e05"],
            ["4–6", "Neutral / processing", "#eb3"],
            ["7–10", "Positive / energized", "#2a4"],
          ] as const).map(([r, l, c]) => (
            <div key={r} className="mood-legend-item" style={{ background: c + "22" }}>
              <div className="mood-legend-dot" style={{ background: c }} />
              <span><strong>{r}</strong> — {l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bubble chart */}
      {entries.length >= 3 && <BubbleChart entries={entries} />}

      {/* Scored entry list */}
      {aiScored.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="section-label">Scored entries</div>
          {aiScored.map((e) => {
            const userScore = e.mood_user;
            const aiScore = e.mood;
            return (
              <div key={e.id} className="entry-card">
                <div className="entry-date">{new Date(e.created_at).toLocaleString()}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                  {userScore != null && (
                    <span className="entry-mood" style={{
                      background: moodColor(userScore) + "22",
                      color: moodColor(userScore),
                    }}>
                      You: {e.mood_user_label} {userScore}/10
                    </span>
                  )}
                  {aiScore != null && (
                    <span className="entry-mood" style={{
                      background: "#6366f122",
                      color: "#6366f1",
                    }}>
                      AI: {e.mood_label} {aiScore}/10
                    </span>
                  )}
                </div>
                <div className="entry-text">
                  {e.text.slice(0, 100)}{e.text.length > 100 ? "…" : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
