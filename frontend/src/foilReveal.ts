/**
 * The gold lettering arriving on the cover, as if foil were being stamped
 * into the leather: the digits one after another clockwise, each with a
 * soft glow and a few sparks that drift up and go out; then the name and
 * the links; then one faint shimmer across all of it from the lamp's side.
 *
 * It is decoration over controls that already work: every button can be
 * pressed from the first frame, and a tap anywhere ends it at once. With
 * reduced motion the lettering simply fades in.
 *
 * Web Animations only (opacity, scale, translate, and the foil's own
 * highlight); everything it adds to the page it takes away again.
 */

import { FOIL_REVEAL_MS, prefersReducedMotion } from "./motion";

const DIGIT_GAP = 58;
const WORDS_AT = 640;
const SHIMMER_AT = 820;
const SHIMMER_SPREAD = 300;
const SHIMMER_MS = FOIL_REVEAL_MS - SHIMMER_AT - SHIMMER_SPREAD;

/** Start the reveal on everything marked `data-foil` inside `root`. Returns a function that ends it. */
export function stampFoil(root: HTMLElement): () => void {
  const on = root.querySelector<HTMLElement>(".diary-on");
  const items = [...root.querySelectorAll<HTMLElement>("[data-foil]")].sort(
    (a, b) => Number(a.dataset.foil) - Number(b.dataset.foil)
  );
  if (!on || items.length === 0) return () => {};

  if (prefersReducedMotion()) {
    const fade = on.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    return () => fade.cancel();
  }

  const running: Animation[] = [];
  const layer = document.createElement("div");
  layer.className = "foil-fx";
  on.appendChild(layer);
  const frame = on.getBoundingClientRect();
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

  let words = 0;
  for (const el of items) {
    const order = Number(el.dataset.foil);
    const digit = order < 10;
    const at = digit ? order * DIGIT_GAP : WORDS_AT + words++ * 70;
    const box = el.getBoundingClientRect();
    if (box.width === 0) continue;
    const cx = box.left + box.width / 2 - frame.left;
    const cy = box.top + box.height / 2 - frame.top;

    // The letter itself: pressed in.
    running.push(
      el.animate(
        [
          { opacity: 0, scale: 1.16 },
          { opacity: 1, scale: 1 },
        ],
        { duration: 300, delay: at, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "backwards" }
      )
    );

    // The glow of the stamp.
    const glow = document.createElement("span");
    glow.className = "foil-glow";
    const size = digit ? box.height * 1.5 : box.height * 2.1;
    glow.style.cssText = `left:${cx}px;top:${cy}px;width:${digit ? size : box.width * 1.15}px;height:${size}px`;
    layer.appendChild(glow);
    running.push(
      glow.animate(
        [
          { opacity: 0, scale: 0.55 },
          { opacity: 0.95, scale: 1, offset: 0.3 },
          { opacity: 0, scale: 1.3 },
        ],
        { duration: 560, delay: at, easing: "ease-out", fill: "both" }
      )
    );

    // A few sparks.
    const sparks = digit ? 3 : 5;
    for (let i = 0; i < sparks; i++) {
      const spark = document.createElement("span");
      spark.className = "foil-spark";
      const s = rand(1.6, 3);
      spark.style.cssText =
        `left:${cx + rand(-0.5, 0.5) * box.width * (digit ? 0.7 : 0.9)}px;` +
        `top:${cy + rand(-0.3, 0.3) * box.height}px;width:${s}px;height:${s}px`;
      layer.appendChild(spark);
      const rise = rand(12, 28);
      const drift = rand(-7, 7);
      running.push(
        spark.animate(
          [
            { opacity: 0, translate: "0 0" },
            { opacity: 1, translate: `${drift * 0.3}px ${-rise * 0.25}px`, offset: 0.2 },
            { opacity: 0, translate: `${drift}px ${-rise}px` },
          ],
          { duration: rand(620, 900), delay: at + rand(40, 220), easing: "cubic-bezier(0.2, 0.6, 0.3, 1)", fill: "both" }
        )
      );
    }

    // The shimmer reaches each piece as it crosses the cover, left to right.
    const across = Math.min(1, Math.max(0, cx / frame.width));
    running.push(
      el.animate(
        [{ backgroundPosition: "130% 0, 0 0" }, { backgroundPosition: "-30% 0, 0 0" }],
        { duration: SHIMMER_MS, delay: SHIMMER_AT + across * SHIMMER_SPREAD, easing: "ease-in-out" }
      )
    );
  }

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    root.removeEventListener("pointerdown", end, true);
    clearTimeout(timer);
    for (const a of running) {
      try {
        a.cancel();
      } catch {
        // Gone with its element.
      }
    }
    layer.remove();
  };
  // A tap ends it (and still does whatever it landed on).
  root.addEventListener("pointerdown", end, true);
  const timer = setTimeout(end, FOIL_REVEAL_MS + 400);
  return end;
}
