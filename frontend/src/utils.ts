// Mood color mapping
const MOOD_COLORS: Record<number, string> = {
  1: "#e05", 2: "#e35", 3: "#e64", 4: "#e94", 5: "#eb3",
  6: "#cb4", 7: "#9b4", 8: "#6b4", 9: "#4a4", 10: "#2a4",
};

export function moodColor(score: number): string {
  return MOOD_COLORS[Math.round(score)] || "#aaa";
}
