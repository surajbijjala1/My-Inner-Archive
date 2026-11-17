import { useLayoutEffect, useState } from "react";
import { useResolvedTheme } from "../theme";
import { sceneFor, sceneReady, type SceneSet } from "./introAssets";

/**
 * Where the video's last frame sits in the window.
 *
 * One placement serves everything that must line up: the video itself, the
 * desk behind the lock scene, the book and the lettering on its cover, and
 * the desk behind the app. It is worked out here and published as CSS
 * variables on the root element; nothing else measures.
 *
 * The frame is scaled to cover the window, anchored on the book, unless that
 * would make the book too large to see whole (an upright phone with a 16:9
 * video). Then the frame is scaled to fit the book, and the desk image, which
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
  /** How much larger the frame would be if it simply covered the window (≥ 1). */
  zoom: number;
}

export function placeScene(set: SceneSet, vw: number, vh: number): ScenePlacement {
  const g = set.geometry;
  const [fw, fh] = g.frame;
  const [bx, by, bw, bh] = g.book;
  // The clasp's strap reaches past the board: it has to be in view too.
  const right = Math.max(bx + bw, g.clasp[0] + g.clasp[2]);
  const cover = Math.max(vw / fw, vh / fh);
  const fit = Math.min((vw - 2 * BOOK_SIDE_GAP) / (right - bx), (vh * BOOK_MAX_HEIGHT) / bh);
  const scale = Math.min(cover, fit);

  const centre = (size: number, frame: number, from: number, to: number) => {
    const wanted = size / 2 - ((from + to) / 2) * scale;
    // Where the frame is bigger than the window, never show past its edge.
    return frame * scale >= size ? Math.min(0, Math.max(size - frame * scale, wanted)) : wanted;
  };
  return {
    scale,
    x: centre(vw, fw, bx, right),
    y: centre(vh, fh, by, by + bh),
    zoom: cover / scale,
  };
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
    "--clasp-x": px((g.clasp[0] - bx) * s),
    "--clasp-y": px((g.clasp[1] - by) * s),
    "--clasp-w": px(g.clasp[2] * s),
    "--clasp-h": px(g.clasp[3] * s),
    // The video is shown covering the window, then drawn back to the frame.
    "--intro-zoom": String(Math.round(p.zoom * 10000) / 10000),
    "--intro-origin": `${px((bx + bw / 2) * s)} ${px((by + bh / 2) * s)}`,
    "--desk-img": `url("${set.desk}")`,
    "--cover-img": `url("${set.cover}")`,
    "--clasp-img": `url("${set.clasp}")`,
  };
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
}

const windowSize = () => ({ w: window.innerWidth, h: window.innerHeight });

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
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const scene = sceneFor(theme, size.h > size.w);
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
