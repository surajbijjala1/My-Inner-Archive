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
/** Tear-out: the rip and the fall. The entry leaves the list when this ends. */
export const TEAR_RIP_MS = 880;
/** Tear-out with reduced motion: one short fade instead. */
export const TEAR_FADE_MS = 220;
/** How long the entries below take to close the gap. */
export const TEAR_CLOSE_MS = 420;

/** How long the rip (or its reduced-motion fade) runs on this device. */
export const tearDuration = (): number => (prefersReducedMotion() ? TEAR_FADE_MS : TEAR_RIP_MS);

/** The entrance: ink line, then the cover. */
export const SPLASH_WRITE_MS = 2000;
export const SPLASH_FADE_MS = 420;
export const COVER_OPEN_MS = 1800;
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
    if (typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    // Decoration only.
  }
}

/**
 * A torn edge as a clip-path polygon: ragged along the top and bottom,
 * nearly straight down the sides. Deterministic, so both layers of the torn
 * piece (the paper and the lighter fibre showing round it) share one shape.
 * `inset` pulls the shape in by that many pixels to leave the fibre fringe.
 */
export function tornEdge(inset: number, seed = 7): string {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s % 1000) / 1000;
  };
  const STEPS = 46;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const x = (i / STEPS) * 100;
    // Alternate teeth with uneven depth: paper tears in runs, not a sawtooth.
    const tTop = (i % 2 === 0 ? 1 : 7.5) * (0.4 + rand() * 0.95) + inset;
    const tBot = (i % 2 === 0 ? 7.5 : 1) * (0.4 + rand() * 0.95) + inset;
    const px = i === 0 ? `${inset}px` : i === STEPS ? `calc(100% - ${inset}px)` : `${x.toFixed(2)}%`;
    top.push(`${px} ${tTop.toFixed(1)}px`);
    bottom.push(`${px} calc(100% - ${tBot.toFixed(1)}px)`);
  }
  return `polygon(${[...top, ...bottom.reverse()].join(", ")})`;
}
