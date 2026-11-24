/**
 * What the archive does, in five lines. This used to be the feature list on
 * the landing page; it is kept here, unchanged, for a future in-app tour.
 * Nothing renders it yet.
 */
export interface TourStop {
  /** Emoji, per the app's icon convention. */
  icon: string;
  title: string;
  description: string;
}

export const TOUR_STOPS: readonly TourStop[] = [
  { icon: "📝", title: "Capture thoughts", description: "Write anything, any time. Timestamped and private." },
  { icon: "🏷️", title: "Tag your context", description: "Record where you were when the insight hit." },
  { icon: "📈", title: "Mood timeline", description: "See your emotional patterns over time, automatically." },
  { icon: "🤖", title: "AI from your words", description: "Your archive answers with only your own words." },
  { icon: "📅", title: "On This Day", description: "See what you wrote on this date in past years." },
];
