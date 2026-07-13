// Mood color mapping
// 6-digit hex so callers can append alpha suffixes like "22" (e.g. "#66bb44" + "22")
const MOOD_COLORS: Record<number, string> = {
  1: "#ee0055", 2: "#ee3355", 3: "#ee6644", 4: "#ee9944", 5: "#eebb33",
  6: "#ccbb44", 7: "#99bb44", 8: "#66bb44", 9: "#44aa44", 10: "#22aa44",
};

export function moodColor(score: number): string {
  return MOOD_COLORS[Math.round(score)] || "#aaa";
}
