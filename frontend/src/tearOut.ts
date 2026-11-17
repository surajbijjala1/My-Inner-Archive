/**
 * Tearing an entry out of the page.
 *
 * The torn piece is not the entry in the list: it is a copy, drawn in a layer
 * of its own over the whole window, so no scrolling panel can clip it and it
 * can fall right out of the bottom of the screen. The entry in the list is
 * hidden the moment the copy takes its place and leaves the list afterwards
 * (useJournal), when the gap closes.
 *
 * Every tear is different. The edge is built from noise at several scales
 * (a slow wander, a medium ripple, fine tooth, and the odd larger bit where
 * the paper let go unevenly); a paler rim of fibre of uneven width shows
 * round it, with a few stray fibres; a thin shadow lies under it.
 *
 * Two beats:
 *   the rip  — travels left to right across the entry (TEAR_TRAVEL_MS) while
 *              the part already free lifts and curls away from the page;
 *   the fall — the piece lets go, tips, and falls under gravity, drifting
 *              and turning, until all of it is below the window. It is never
 *              faded: it is removed only once it is out of sight.
 */

import { TEAR_TRAVEL_MS } from "./motion";

/** Room round the entry's text that comes away with it. */
const MARGIN_X = 14;
const MARGIN_Y = 13;
/** Room round the piece for the fibre that sticks out past the paper. */
const FRINGE = 9;
const GRAVITY = 2600; // px/s²

type Point = [number, number];

/** Smooth noise along a line: random values at `step`-pixel knots, eased between. */
function wander(length: number, step: number, rand: () => number): (x: number) => number {
  const knots = Array.from({ length: Math.ceil(length / step) + 2 }, () => rand() * 2 - 1);
  return (x) => {
    const at = x / step;
    const i = Math.floor(at);
    const t = at - i;
    const s = t * t * (3 - 2 * t);
    return knots[i] * (1 - s) + knots[i + 1] * s;
  };
}

/**
 * How far the tear strays from a straight line along one edge, in pixels,
 * sampled at uneven intervals. Positive is into the paper.
 */
function tornLine(length: number, roughness: number, rand: () => number): Point[] {
  const slow = wander(length, 90 + rand() * 60, rand);
  const mid = wander(length, 17 + rand() * 9, rand);
  const fine = wander(length, 4.5 + rand() * 2, rand);
  const out: Point[] = [];
  let x = 0;
  // Where the paper let go in a bigger bite: a few per edge, never regular.
  let nextBit = 20 + rand() * 70;
  while (x < length) {
    let d = slow(x) * 2.6 + mid(x) * 2.1 + fine(x) * 1.15;
    if (x >= nextBit) {
      d += (rand() < 0.5 ? -1 : 1) * (2.5 + rand() * 4);
      nextBit = x + 28 + rand() * 110;
    }
    out.push([x, d * roughness]);
    x += 1.6 + rand() * 4.4; // uneven spacing: no two teeth the same width
  }
  out.push([length, slow(length) * 2.6 * roughness]);
  return out;
}

interface Outline {
  paper: Point[];
  fibre: Point[];
  hairs: [Point, Point][];
}

/** The outline of the torn piece and the fibre round it, for a w × h box. */
function tornOutline(w: number, h: number, rand: () => number): Outline {
  const inset = 5; // the straight line the tear wanders about
  const top = tornLine(w, 1, rand);
  const bottom = tornLine(w, 1, rand);
  const left = tornLine(h, 0.55, rand);
  const right = tornLine(h, 0.55, rand);

  // Walk the four edges clockwise, keeping each point's outward direction.
  const walk: { p: Point; n: Point }[] = [
    ...top.map(([x, d]) => ({ p: [x, inset + d] as Point, n: [0, -1] as Point })),
    ...right.map(([y, d]) => ({ p: [w - inset - d, y] as Point, n: [1, 0] as Point })),
    ...bottom.reverse().map(([x, d]) => ({ p: [x, h - inset - d] as Point, n: [0, 1] as Point })),
    ...left.reverse().map(([y, d]) => ({ p: [inset + d, y] as Point, n: [-1, 0] as Point })),
  ].filter(({ p }) => p[0] >= inset - 6 && p[0] <= w - inset + 6 && p[1] >= inset - 6 && p[1] <= h - inset + 6);

  // The fibre rim: the same line pushed outward by an amount that itself
  // wanders, so the pale edge is thick in places and almost nothing in others.
  const rim = wander(walk.length, 7, rand);
  const paper = walk.map(({ p }) => p);
  const fibre = walk.map(({ p, n }, i): Point => {
    const out = 0.5 + (rim(i) * 0.5 + 0.5) * 2.4 + (rand() < 0.07 ? rand() * 2.2 : 0);
    return [p[0] + n[0] * out, p[1] + n[1] * out];
  });

  // A few fibres that pulled right out: short, thin, at odd angles.
  const hairs: [Point, Point][] = [];
  const count = Math.round((w + h) / 26);
  for (let i = 0; i < count; i++) {
    const { p, n } = walk[Math.floor(rand() * walk.length)];
    const len = 2.5 + rand() * 6;
    const lean = (rand() - 0.5) * 1.5;
    hairs.push([p, [p[0] + (n[0] + (n[0] ? 0 : lean)) * len, p[1] + (n[1] + (n[1] ? 0 : lean)) * len]]);
  }
  return { paper, fibre, hairs };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const points = (ps: Point[], dx = 0, dy = 0) => ps.map(([x, y]) => `${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}`).join(" ");
const polygon = (ps: Point[]) => `polygon(${ps.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;

/**
 * Tear `sheet` (an entry as drawn in the list) out of the page. The caller
 * hides the original; this draws the piece and takes it away. Fire and
 * forget: it cleans up after itself and never throws.
 */
export function tearOut(sheet: HTMLElement): void {
  try {
    const box = sheet.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const rand = Math.random;
    const w = box.width + MARGIN_X * 2;
    const h = box.height + MARGIN_Y * 2;
    const { paper, fibre, hairs } = tornOutline(w, h, rand);

    const layer = document.createElement("div");
    layer.className = "tear-layer";
    layer.setAttribute("aria-hidden", "true");

    // The entry as it lay, untouched, until the rip reaches it.
    const lying = document.createElement("div");
    lying.className = "tear-lying";
    lying.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    lying.appendChild(copyOf(sheet));

    // The torn piece.
    const piece = document.createElement("div");
    piece.className = "tear-piece";
    piece.style.cssText = `left:${box.left - MARGIN_X}px;top:${box.top - MARGIN_Y}px;width:${w}px;height:${h}px`;

    const rim = document.createElementNS(SVG_NS, "svg");
    rim.setAttribute("class", "tear-fibre");
    rim.setAttribute("width", String(w + FRINGE * 2));
    rim.setAttribute("height", String(h + FRINGE * 2));
    rim.style.cssText = `left:${-FRINGE}px;top:${-FRINGE}px`;
    const rimShape = document.createElementNS(SVG_NS, "polygon");
    rimShape.setAttribute("points", points(fibre, FRINGE, FRINGE));
    rim.appendChild(rimShape);
    for (const [a, b] of hairs) {
      const hair = document.createElementNS(SVG_NS, "line");
      hair.setAttribute("x1", (a[0] + FRINGE).toFixed(1));
      hair.setAttribute("y1", (a[1] + FRINGE).toFixed(1));
      hair.setAttribute("x2", (b[0] + FRINGE).toFixed(1));
      hair.setAttribute("y2", (b[1] + FRINGE).toFixed(1));
      hair.setAttribute("stroke-width", (0.5 + rand() * 0.6).toFixed(2));
      rim.appendChild(hair);
    }

    const leaf = document.createElement("div");
    leaf.className = "tear-paper";
    leaf.style.clipPath = polygon(paper);
    const words = copyOf(sheet);
    words.style.cssText += `;position:absolute;left:${MARGIN_X}px;top:${MARGIN_Y}px;width:${box.width}px`;
    leaf.appendChild(words);

    piece.append(rim, leaf);
    layer.append(lying, piece);
    document.body.appendChild(layer);

    // ── The rip: left to right ────────────────────────────────────────────
    const T = TEAR_TRAVEL_MS;
    const travel = "cubic-bezier(0.35, 0.1, 0.4, 1)";
    lying.animate(
      [{ clipPath: "inset(-20px 0 -20px 0)" }, { clipPath: "inset(-20px 0 -20px 100%)" }],
      { duration: T, easing: travel, fill: "forwards" }
    );
    piece.animate(
      [
        { clipPath: `inset(-40px 100% -40px -40px)` },
        { clipPath: `inset(-40px -40px -40px -40px)` },
      ],
      { duration: T, easing: travel, fill: "forwards" }
    );

    // The free end lifts and curls toward you while the far end still holds.
    const dir = rand() < 0.5 ? -1 : 1; // which way it will go once it is free
    const lift = 5 + rand() * 4;
    const curl = 9 + rand() * 6;
    const held = `perspective(900px) translateY(${-lift}px) rotate(${-1.4 - rand()}deg) rotateY(${-curl}deg)`;
    piece.style.transformOrigin = "100% 50%";
    const rip = piece.animate(
      [
        { transform: "perspective(900px) translateY(0) rotate(0deg) rotateY(0deg)" },
        { transform: held },
      ],
      { duration: T, easing: "cubic-bezier(0.3, 0, 0.5, 1)", fill: "forwards", composite: "replace" }
    );

    // ── The fall ─────────────────────────────────────────────────────────
    rip.finished
      .then(() => {
        lying.remove();
        const vx = dir * (50 + rand() * 110); // sideways drift, px/s
        const vy = -70 - rand() * 60; // a small flick upward as it lets go
        const spin = dir * (55 + rand() * 80); // deg/s
        const flutter = 14 + rand() * 12; // deg, tipping toward and away
        const reach = Math.hypot(w, h) / 2 + 30;
        const drop = window.innerHeight - (box.top - MARGIN_Y) + reach;
        // v·t + ½·g·t² = drop
        const seconds = (-vy + Math.sqrt(vy * vy + 2 * GRAVITY * drop)) / GRAVITY;
        const STEPS = 22;
        const frames: Keyframe[] = [];
        for (let i = 0; i <= STEPS; i++) {
          const t = (i / STEPS) * seconds;
          const x = vx * t + Math.sin(t * 5.2) * 9 * dir;
          const y = -lift + vy * t + 0.5 * GRAVITY * t * t;
          const rot = -1.9 + spin * t;
          const tip = -curl * Math.max(0, 1 - t * 4) + Math.sin(t * 6.3) * flutter * Math.min(1, t * 3);
          frames.push({
            transform: `perspective(900px) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) rotateX(${tip.toFixed(1)}deg)`,
            offset: i / STEPS,
          });
        }
        piece.style.transformOrigin = "50% 50%";
        piece.style.transform = held;
        rip.cancel();
        return piece.animate(frames, { duration: seconds * 1000, easing: "linear", fill: "forwards" }).finished;
      })
      .catch(() => {})
      .finally(() => layer.remove());
  } catch {
    // Decoration only: the entry still leaves the list.
  }
}

/** A copy of the entry for drawing: no ids, nothing to press. */
function copyOf(sheet: HTMLElement): HTMLElement {
  const copy = sheet.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  copy.querySelectorAll(".entry-tear").forEach((el) => el.remove());
  copy.style.animation = "none";
  copy.style.visibility = "visible";
  return copy;
}

/**
 * The ragged line the page keeps where the entry was torn from it: a path
 * for an SVG `width` wide and about 12 tall. Different every time.
 */
export function tornScar(width: number): string {
  const line = tornLine(width, 0.8, Math.random);
  return line.map(([x, d], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(6 + d * 0.7).toFixed(1)}`).join(" ");
}
