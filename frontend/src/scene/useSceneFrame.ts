import { useLayoutEffect, useState } from "react";
import { useResolvedTheme } from "../theme";
import { sceneFor, sceneReady, type SceneSet } from "./introAssets";
import { PHONE_LAYOUT } from "../layouts/layout";

/**
 * Where the video's last frame sits in the window.
 *
 * One placement serves everything that must line up: the video itself, the
 * desk behind the lock scene, the book and the lettering on its cover, and
 * the desk behind the app. It is worked out here and published as CSS
 * variables on the root element; nothing else measures.
 *
 * The frame is scaled to cover the window, anchored on the book, unless that
 * would make the book too large to see whole (a phone narrower than its
 * upright video, or a 16:9 video on an upright window). Then the frame is scaled to fit the book, and the desk image, which
 * carries on past the frame's edges, fills the rest.
 */

/** The book may take this much of the window's height, and comes this close to its sides. */
const BOOK_MAX_HEIGHT = 0.95;
const BOOK_SIDE_GAP = 5;

export interface ScenePlacement {
  /** Window pixels per frame pixel. */
  scale: number;
  /** The frame's top-left corner in the window. */
  x: number;
  y: number;
  /** How much the frame is enlarged, about the book's centre, to cover the window while the video plays (≥ 1). */
  zoom: number;
}

export function placeScene(set: SceneSet, vw: number, vh: number): ScenePlacement {
  const g = set.geometry;
  const [fw, fh] = g.frame;
  const [bx, by, bw, bh] = g.book;
  // The clasp's strap reaches past the board: it has to be in view too.
  const right = Math.max(bx + bw, g.clasp[0] + g.clasp[2]);
  const cover = Math.max(vw / fw, vh / fh);

  // A scene shown whole: the full frame, as large as fits, in the middle.
  // Nothing is cropped and nothing is enlarged; the blurred fill takes the
  // rest of the window.
  if (g.feather) {
    const whole = Math.min(vw / fw, vh / fh);
    return { scale: whole, x: (vw - fw * whole) / 2, y: (vh - fh * whole) / 2, zoom: 1 };
  }
  const fit = Math.min((vw - 2 * BOOK_SIDE_GAP) / (right - bx), (vh * BOOK_MAX_HEIGHT) / bh);
  const scale = Math.min(cover, fit);

  const centre = (size: number, frame: number, from: number, to: number) => {
    const wanted = size / 2 - ((from + to) / 2) * scale;
    // Where the frame is bigger than the window, never show past its edge.
    return frame * scale >= size ? Math.min(0, Math.max(size - frame * scale, wanted)) : wanted;
  };
  const x = centre(vw, fw, bx, right);
  const y = centre(vh, fh, by, by + bh);

  // While it plays, the video is enlarged about the book's centre (the
  // --intro-origin) until it reaches every edge of the window. The book is
  // rarely in the middle of its frame, so each edge needs its own factor;
  // the largest wins. (Enlarging by cover / scale alone, as if the frame
  // were centred, left a strip of desk showing at the top on phones.)
  const ox = x + (bx + bw / 2) * scale;
  const oy = y + (by + bh / 2) * scale;
  const reach = (origin: number, near: number, far: number, size: number) =>
    Math.max(
      near < 0 ? 1 : origin / Math.max(origin - near, 1e-3),
      far > size ? 1 : (size - origin) / Math.max(far - origin, 1e-3)
    );
  const zoom = Math.max(
    1,
    reach(ox, x, x + fw * scale, vw),
    reach(oy, y, y + fh * scale, vh)
  );
  return { scale, x, y, zoom };
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function publish(set: SceneSet, p: ScenePlacement): void {
  const g = set.geometry;
  const s = p.scale;
  const [bx, by, bw, bh] = g.book;
  const style = document.documentElement.style;
  const vars: Record<string, string> = {
    "--scene-u": px(s),
    "--frame-x": px(p.x),
    "--frame-y": px(p.y),
    "--frame-w": px(g.frame[0] * s),
    "--frame-h": px(g.frame[1] * s),
    "--desk-x": px(p.x - g.pad[0] * s),
    "--desk-y": px(p.y - g.pad[1] * s),
    "--desk-w": px((g.frame[0] + 2 * g.pad[0]) * s),
    "--book-x": px(p.x + bx * s),
    "--book-y": px(p.y + by * s),
    "--book-w": px(bw * s),
    "--book-h": px(bh * s),
    // Inside the book, measured from its own corner.
    "--wreath-x": px((g.wreath[0] - bx) * s),
    "--wreath-y": px((g.wreath[1] - by) * s),
    "--wreath-r": px(g.outer * s),
    "--medallion-r": px(g.medallion * s),
    "--ring-r": px(g.ring * s),
    "--clasp-x": px((g.clasp[0] - bx) * s),
    "--clasp-y": px((g.clasp[1] - by) * s),
    "--clasp-w": px(g.clasp[2] * s),
    "--clasp-h": px(g.clasp[3] * s),
    // The video is shown covering the window, then drawn back to the frame.
    "--intro-zoom": String(Math.round(p.zoom * 10000) / 10000),
    "--intro-origin": `${px((bx + bw / 2) * s)} ${px((by + bh / 2) * s)}`,
    "--desk-img": `url("${set.desk}")`,
    ...fillVars(set, window.innerWidth, window.innerHeight),
    "--cover-img": `url("${set.cover}")`,
    "--clasp-img": `url("${set.clasp}")`,
  };
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
}

const isPhone = (): boolean => {
  try {
    return window.matchMedia(PHONE_LAYOUT).matches;
  } catch {
    return window.innerWidth <= 768;
  }
};

/** The FILL is drawn this much larger than "cover", so the blur's soft rim falls outside the window. */
const FILL_OVERSIZE = 1.08;

/** Where the blurred fill round a scene shown whole is drawn, and how. None for other scenes. */
function fillVars(set: SceneSet, vw: number, vh: number): Record<string, string> {
  const g = set.geometry;
  if (!set.fill || !g.feather || !g.fill) {
    return { "--fill-img": "none", "--fill-w": "0px", "--fill-h": "0px", "--fill-x": "0px", "--fill-y": "0px" };
  }
  const [fw, fh] = g.frame;
  const cs = Math.max(vw / fw, vh / fh) * FILL_OVERSIZE;
  return {
    "--fill-img": `url("${set.fill}")`,
    "--fill-w": px(fw * cs),
    "--fill-h": px(fh * cs),
    "--fill-x": px((vw - fw * cs) / 2),
    "--fill-y": px((vh - fh * cs) / 2),
    // The still is blurred by `sigma` frame px; the live canvas gets the same blur on screen.
    "--fill-blur": px(g.fill.sigma * cs),
    "--fill-dim": String(g.fill.dim),
    "--feather-x": `${g.feather[0] * 100}%`,
    "--feather-y": `${g.feather[1] * 100}%`,
  };
}

const windowSize = () => ({ w: window.innerWidth, h: window.innerHeight, phone: isPhone() });

/**
 * Keeps the scene placed for the current theme and window, and says which
 * scene that is (for the video). Call once, at the top of the app.
 */
export function useSceneFrame(): { scene: SceneSet | null; zoom: number } {
  const theme = useResolvedTheme();
  const [size, setSize] = useState(windowSize);

  useLayoutEffect(() => {
    const onResize = () => setSize(windowSize());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    // Crossing the phone breakpoint changes which video is used; some
    // browsers (and device emulation) report that without a resize event.
    let query: MediaQueryList | null = null;
    try {
      query = window.matchMedia(PHONE_LAYOUT);
      query.addEventListener("change", onResize);
    } catch {
      query = null;
    }
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      query?.removeEventListener("change", onResize);
    };
  }, []);

  const scene = sceneFor(theme, size.phone);
  const placement = scene ? placeScene(scene, size.w, size.h) : null;

  useLayoutEffect(() => {
    if (scene && placement) publish(scene, placement);
    // The placement is derived from exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.name, size.w, size.h]);

  // The desk and the book are wanted the moment the lock scene shows: fetch
  // them once the page has had its first paint, not before.
  useLayoutEffect(() => {
    if (!scene) return;
    const timer = setTimeout(() => {
      void sceneReady(scene);
      if (scene.poster) new Image().src = scene.poster;
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.name]);

  return { scene, zoom: placement?.zoom ?? 1 };
}
