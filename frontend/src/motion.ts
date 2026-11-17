/**
 * Timings and small helpers shared by the app's few animations, so the
 * script that waits for an animation and the CSS that draws it agree.
 * Every animation here moves with transform/opacity only.
 */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the device asks for less motion. False if the query can't be answered. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Tear-out: the least time an entry trembles before it rips, however fast the server answers. */
export const TEAR_TREMBLE_MS = 380;
/** Tear-out: how long the rip takes to travel across the entry. */
export const TEAR_TRAVEL_MS = 440;
/** Tear-out: rip, then a beat while the piece starts to fall. The entry leaves the list (and the gap closes) when this ends. */
export const TEAR_RIP_MS = TEAR_TRAVEL_MS + 300;
/** Tear-out with reduced motion: one short fade instead. */
export const TEAR_FADE_MS = 220;
/** How long the entries below take to close the gap. */
export const TEAR_CLOSE_MS = 460;

/** How long until the torn entry leaves the list on this device. */
export const tearDuration = (): number => (prefersReducedMotion() ? TEAR_FADE_MS : TEAR_RIP_MS);

/** The entrance: ink line, then the cover. */
export const SPLASH_WRITE_MS = 2000;
export const SPLASH_FADE_MS = 420;
/** The whole opening, PIN to app: one timeline (openBook.ts). */
export const COVER_OPEN_MS = 2300;
/** Leaving the lock scene without the cover swing (after a lock, or reduced motion). */
export const SCENE_FADE_MS = 320;
/** The phone's page turn. */
export const PAGE_TURN_MS = 440;

/**
 * A short buzz on phones that allow it. Uses the browser's own vibration
 * call, so it needs no plugin; where it isn't permitted it does nothing.
 */
export function haptic(ms = 14): void {
  try {
    // Browsers refuse (and log) a vibration before the first real tap.
    const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (active && !active.hasBeenActive) return;
    if (typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    // Decoration only.
  }
}
