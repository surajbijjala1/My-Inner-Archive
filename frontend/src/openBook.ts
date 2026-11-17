/**
 * The book opening into the app: one timeline, built once the PIN is right.
 *
 * Nothing is swapped. The real app is already drawn beneath the lock scene;
 * its book is shrunk and moved so that its page sits exactly under the
 * closed cover, and then everything is let go at once:
 *
 *   wide screen — the cover swings over on the spine while the book grows to
 *     its place. The chat page shows as the cover lifts; the journal page
 *     arrives under the cover as it lands on the left.
 *   phone — the cover opens to show the whole spread, then the view closes
 *     in on the right-hand page until it is the screen.
 *
 * Every animation is a transform or an opacity on the compositor (Web
 * Animations API, no library). The book and the cover follow the same
 * straight-line interpolation with the same easing, so they stay locked.
 * The last keyframe of everything is its natural, un-animated state, so
 * ending (or skipping) the timeline changes nothing on screen.
 */

import { COVER_OPEN_MS } from "./motion";
import { PHONE_LAYOUT } from "./layouts/layout";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** The transform (origin: the element's own top-left) that carries box `from` onto box `to`. */
function carry(origin: Box, from: Box, to: Box): { x: number; y: number; sx: number; sy: number } {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return {
    sx,
    sy,
    x: to.left - origin.left - (from.left - origin.left) * sx,
    y: to.top - origin.top - (from.top - origin.top) * sy,
  };
}

const tf = (t: { x: number; y: number; sx: number; sy: number }) =>
  `translate(${t.x}px, ${t.y}px) scale(${t.sx}, ${t.sy})`;

const REST = { x: 0, y: 0, sx: 1, sy: 1 };

/** Gentle in, long gentle out. Shared by everything that must move together. */
const GLIDE = "cubic-bezier(0.5, 0, 0.12, 1)";
const SOFT = "cubic-bezier(0.45, 0, 0.3, 1)";

/**
 * Start the opening. Returns a function that ends it at once and puts every
 * animated element back to its own styles (call it when the scene goes).
 */
export function openBook(scene: HTMLElement): () => void {
  const phone = window.matchMedia(PHONE_LAYOUT).matches;
  const diary = scene.querySelector<HTMLElement>(".diary");
  const leaf = scene.querySelector<HTMLElement>(".diary-leaf");
  const page = [...document.querySelectorAll<HTMLElement>("[data-book-landing]")].find(
    (el) => el.getClientRects().length > 0
  );
  const book = page?.closest<HTMLElement>(".book") ?? null;
  if (!diary || !leaf || !page || !book) return () => {};

  const running: Animation[] = [];
  const D = COVER_OPEN_MS;
  const run = (el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions = {}) => {
    if (!el) return;
    running.push(el.animate(frames, { duration: D, fill: "both", easing: "linear", ...options }));
  };
  /** Fade between two opacities over part of the timeline. */
  const fade = (el: Element | null | undefined, from: number, to: number, start: number, end: number) =>
    run(el, [
      { opacity: from, offset: 0 },
      { opacity: from, offset: start, easing: SOFT },
      { opacity: to, offset: end },
      { opacity: to, offset: 1 },
    ]);
  const each = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];

  const cover = boxOf(diary); // the closed book, where it lies
  const bookBox = boxOf(book);
  const pageBox = boxOf(page); // where that page really belongs
  // Everything is measured here, before anything is animated: once an
  // animation is attached, these boxes would be the moving ones.
  const spineEl = book.querySelector<HTMLElement>(".panel-resizer");
  const spineBox = spineEl ? boxOf(spineEl) : null;

  // ── What is on the closed book, and the scene around it, lets go ────────
  each(".diary-on, .scene-head, .scene-foot", scene).forEach((el) => fade(el, 1, 0, 0, 0.12));
  run(scene.querySelector(".diary-clasp"), [
    { transform: "rotate(0deg)", opacity: 1, offset: 0, easing: SOFT },
    { transform: "rotate(34deg) translate(10%, -6%)", opacity: 1, offset: 0.07 },
    { transform: "rotate(52deg) translate(26%, -10%)", opacity: 0, offset: 0.16 },
    { transform: "rotate(52deg) translate(26%, -10%)", opacity: 0, offset: 1 },
  ]);
  each(".diary-shadow, .diary-block", scene).forEach((el) => fade(el, 1, 0, 0.04, 0.3));
  // The scene's own desk is the same desk the app lies on: it only has to go.
  fade(scene.querySelector(".scene-desk"), 1, 0, 0, 0.02);
  run(scene.querySelector(".scene-lamp"), [
    { transform: "none", opacity: 1, offset: 0, easing: GLIDE },
    { transform: phone ? "translate(-30%, -46%) scale(1.5)" : "translate(-46%, -30%) scale(1.45)", opacity: 0, offset: 0.34 },
    { transform: phone ? "translate(-30%, -46%) scale(1.5)" : "translate(-46%, -30%) scale(1.45)", opacity: 0, offset: 1 },
  ]);
  each(".scene-shade, .scene-warm", scene).forEach((el) => {
    const now = Number(getComputedStyle(el).opacity);
    fade(el, now, 0, 0.1, 0.86);
  });

  // The real book comes up under the cover as the cover's own page block
  // goes, so nothing of it shows round the closed cover's corners.
  fade(book, 0, 1, 0.03, 0.2);

  // ── The app's own chrome waits for the book to arrive ───────────────────
  each(".top-actions, .action-bar").forEach((el) => fade(el, 0, 1, 0.78, 1));

  if (!phone) {
    // The book starts with its right-hand page exactly under the cover.
    const start = carry(bookBox, pageBox, cover);
    run(
      book,
      [
        { transform: tf(start), offset: 0 },
        { transform: tf(start), offset: 0.05, easing: GLIDE },
        { transform: tf(REST), offset: 1 },
      ],
      { composite: "replace" }
    );
    book.style.transformOrigin = "0 0";

    // The cover rides on that page the whole way.
    const end = carry(cover, cover, pageBox);
    run(diary, [
      { transform: tf(REST), offset: 0 },
      { transform: tf(REST), offset: 0.05, easing: GLIDE },
      { transform: tf(end), offset: 1 },
    ]);

    // The spine is a little left of the page; the cover turns on the spine,
    // and its inside is the size of the left-hand half of the book.
    const spineMid = spineBox ? spineBox.left + spineBox.width / 2 : pageBox.left;
    const hinge = (pageBox.left - spineMid) / pageBox.width;
    const BOARD = 5;
    const leftHalf = (spineMid - bookBox.left + BOARD) / pageBox.width;
    leaf.style.transformOrigin = `${-hinge * 100}% 50%`;
    scene.style.setProperty("--back-left", `${-hinge * 100}%`);
    scene.style.setProperty("--back-width", `${leftHalf * 100}%`);
    scene.style.setProperty("--back-board", `${(BOARD / pageBox.height) * 100}%`);

    run(leaf, [
      { transform: "rotateY(0deg)", offset: 0 },
      { transform: "rotateY(0deg)", offset: 0.07, easing: "cubic-bezier(0.5, 0, 0.25, 1)" },
      { transform: "rotateY(-180deg)", offset: 0.66 },
      { transform: "rotateY(-180deg)", offset: 1 },
    ]);

    // Until the cover has come down, there is no left-hand half: it is the
    // inside of the cover, and the cover brings it. One switch, made while
    // the cover hides it; not an animated clip.
    const spineInBook = spineMid - bookBox.left;
    run(book, [
      { clipPath: `inset(-80px -80px -80px ${spineInBook}px)`, offset: 0, easing: "step-end" },
      { clipPath: "inset(-80px -80px -80px -80px)", offset: 0.64 },
      { clipPath: "inset(-80px -80px -80px -80px)", offset: 1 },
    ]);
    fade(scene.querySelector(".diary-back"), 1, 0, 0.66, 0.86);

    // The chat shows as the cover lifts; the journal as the cover leaves it.
    each(":scope > *", page).forEach((el) => fade(el, 0, 1, 0.26, 0.62));
    fade(book.querySelector(".panel-left"), 0, 1, 0.64, 0.92);
  } else {
    // Phone. First the cover opens and the book draws back until the whole
    // spread is in view; then the view closes in on the right-hand page.
    const vw = window.innerWidth;
    const spreadW = Math.min(vw * 0.47, 230);
    const spreadH = spreadW * (cover.height / cover.width);
    const spread: Box = {
      left: vw / 2 + 1,
      top: cover.top + (cover.height - spreadH) / 2,
      width: spreadW,
      height: spreadH,
    };
    const TURN = 0.44; // where the first move ends and the second begins

    const p0 = carry(bookBox, pageBox, cover);
    const p1 = carry(bookBox, pageBox, spread);
    book.style.transformOrigin = "0 0";
    run(book, [
      { transform: tf(p0), offset: 0 },
      { transform: tf(p0), offset: 0.05, easing: SOFT },
      { transform: tf(p1), offset: TURN, easing: GLIDE },
      { transform: tf(REST), offset: 1 },
    ]);

    const c1 = carry(cover, cover, spread);
    const c2 = carry(cover, cover, pageBox);
    run(diary, [
      { transform: tf(REST), offset: 0 },
      { transform: tf(REST), offset: 0.05, easing: SOFT },
      { transform: tf(c1), offset: TURN, easing: GLIDE },
      { transform: tf(c2), offset: 1 },
    ]);

    // The page is far taller than the cover, so the book is squeezed more
    // in height than in width. The page's contents are stretched back by
    // exactly the difference: the writing keeps its shape and the book
    // simply shows less of the page while it is small. The correction is
    // not a straight line, so it is sampled along the same two moves.
    const inner = page.querySelector<HTMLElement>(".mobile-content");
    if (inner) {
      const ease = (bez: [number, number, number, number]) => {
        const [x1, y1, x2, y2] = bez;
        const at = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
        return (x: number) => {
          let lo = 0;
          let hi = 1;
          for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (at(x1, x2, mid) < x) lo = mid;
            else hi = mid;
          }
          return at(y1, y2, (lo + hi) / 2);
        };
      };
      const soft = ease([0.45, 0, 0.3, 1]);
      const glide = ease([0.5, 0, 0.12, 1]);
      const mix = (a: number, b: number, t: number) => a + (b - a) * t;
      const frames: Keyframe[] = [];
      const STEPS = 48;
      for (let i = 0; i <= STEPS; i++) {
        const offset = i / STEPS;
        let sx: number;
        let sy: number;
        if (offset <= 0.05) {
          sx = p0.sx;
          sy = p0.sy;
        } else if (offset <= TURN) {
          const t = soft((offset - 0.05) / (TURN - 0.05));
          sx = mix(p0.sx, p1.sx, t);
          sy = mix(p0.sy, p1.sy, t);
        } else {
          const t = glide((offset - TURN) / (1 - TURN));
          sx = mix(p1.sx, 1, t);
          sy = mix(p1.sy, 1, t);
        }
        frames.push({ transform: `scale(1, ${sx / sy})`, offset });
      }
      inner.style.transformOrigin = "0 0";
      run(inner, frames);
      // The writing comes up on the page once the cover is clear of it.
      each(":scope > *", inner).forEach((el) => fade(el, 0, 1, 0.24, 0.5));
    }

    leaf.style.transformOrigin = "0 50%";
    scene.style.setProperty("--back-left", "0%");
    scene.style.setProperty("--back-width", "100%");
    scene.style.setProperty("--back-board", "0%");
    run(leaf, [
      { transform: "rotateY(0deg)", offset: 0 },
      { transform: "rotateY(0deg)", offset: 0.06, easing: "cubic-bezier(0.5, 0, 0.25, 1)" },
      { transform: "rotateY(-180deg)", offset: TURN + 0.04 },
      { transform: "rotateY(-180deg)", offset: 1 },
    ]);
  }

  return () => {
    for (const a of running) {
      try {
        a.cancel();
      } catch {
        // Already gone with its element.
      }
    }
    book.style.transformOrigin = "";
    const inner = page.querySelector<HTMLElement>(".mobile-content");
    if (inner) inner.style.transformOrigin = "";
  };
}
