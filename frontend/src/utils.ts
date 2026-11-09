// Mood color mapping
// 6-digit hex so callers can append alpha suffixes like "22" (e.g. "#66bb44" + "22")
const MOOD_COLORS: Record<number, string> = {
  1: "#ee0055", 2: "#ee3355", 3: "#ee6644", 4: "#ee9944", 5: "#eebb33",
  6: "#ccbb44", 7: "#99bb44", 8: "#66bb44", 9: "#44aa44", 10: "#22aa44",
};

export function moodColor(score: number): string {
  return MOOD_COLORS[Math.round(score)] || "#aaa";
}

/* ===== The page's own way of telling time =====
   The design writes times as "8:20a" / "11:04p" and dates as "Wed · Jan 15",
   both in handwriting. Kept here so the journal, the writing view and the
   patterns screen all speak the same way. */

export function formatEntryTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h12}:${m}${h < 12 ? "a" : "p"}`;
}

export function formatDayHeading(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const rest = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} · ${rest}`;
}

/** Local calendar day, so entries group by the day you experienced. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Newest day first, and newest entry first within each day. */
export function groupByDay<T extends { created_at: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(item.created_at);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort(
        (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
      );
      return [sorted[0].created_at, sorted] as [string, T[]];
    })
    .sort((a, b) => +new Date(b[0]) - +new Date(a[0]));
}

/**
 * Activity tags are stored with their emoji prefix ("🪞 Reflecting") and the
 * AI prompts read that column, so storage is left alone. The paper design
 * writes them plainly, so the prefix is dropped at display time only.
 */
export function tagLabel(activity: string): string {
  return activity.replace(/^\s*\P{L}+\s*/u, "").trim() || activity.trim();
}
