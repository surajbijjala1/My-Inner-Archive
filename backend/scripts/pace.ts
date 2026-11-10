/**
 * Spacing for the live-model evals. The free tier allows 15 requests a minute
 * per model; firing faster made most cases fall through to the fallback paths,
 * which then got scored as if the model had answered. ~13/min stays clear.
 */
export const PACE_MS = 4_600;

export const pace = (calls = 1): Promise<void> =>
  new Promise((r) => setTimeout(r, PACE_MS * calls));
