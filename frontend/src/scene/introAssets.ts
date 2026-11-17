import manifest from "../assets/intro/manifest.json";
import type { ResolvedTheme } from "../theme";

/**
 * The intro videos and the pieces cut from their last frames
 * (src/assets/intro, built by scripts/build-intro-assets.py).
 *
 * Each scene is one video: `dark`, `light`, and, when they exist,
 * `dark-portrait` and `light-portrait` for an upright screen. Nothing here
 * names a portrait file: if the build script has written one it is found,
 * and until then an upright screen uses the 16:9 scene.
 */

/** Where things are in a video's last frame, in that frame's own pixels. */
export interface SceneGeometry {
  /** The frame: width, height. */
  frame: [number, number];
  /** How far the desk image carries on past the frame: x, y. */
  pad: [number, number];
  /** The closed book: left, top, width, height. */
  book: [number, number, number, number];
  /** The centre of the wreath on the cover. */
  wreath: [number, number];
  /** Radius of the medallion at the wreath's centre. */
  medallion: number;
  /** Radius of the wreath's outer edge. */
  outer: number;
  /** The clasp: left, top, width, height. */
  clasp: [number, number, number, number];
}

export interface SceneSet {
  name: string;
  geometry: SceneGeometry;
  /** The desk with the book lifted off it. */
  desk: string;
  /** The book, cut out. */
  cover: string;
  /** The clasp, cut out. */
  clasp: string;
  /** The video and its first frame. Missing if the files are. */
  video?: string;
  poster?: string;
}

const files = import.meta.glob("../assets/intro/*.{webp,mp4}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const file = (name: string): string | undefined => files[`../assets/intro/${name}`];

const geometries = manifest as unknown as Record<string, SceneGeometry | undefined>;

function sceneNamed(name: string): SceneSet | null {
  const geometry = geometries[name];
  const desk = file(`${name}-desk.webp`);
  const cover = file(`${name}-cover.webp`);
  const clasp = file(`${name}-clasp.webp`);
  if (!geometry || !desk || !cover || !clasp) return null;
  return { name, geometry, desk, cover, clasp, video: file(`${name}.mp4`), poster: file(`${name}-poster.webp`) };
}

/** The scene for this theme and screen shape. Null only if the assets were never built. */
export function sceneFor(theme: ResolvedTheme, upright: boolean): SceneSet | null {
  return (upright ? sceneNamed(`${theme}-portrait`) : null) ?? sceneNamed(theme) ?? sceneNamed("dark") ?? sceneNamed("light");
}

const ready = new Map<string, Promise<void>>();

/**
 * Resolves once the scene's desk, book and clasp are fetched and decoded, so
 * the lock scene can be shown complete. Never rejects: a picture that fails
 * counts as done (the desk colour stands in for it).
 */
export function sceneReady(set: SceneSet): Promise<void> {
  let wait = ready.get(set.name);
  if (!wait) {
    const one = (src: string) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => undefined);
    };
    wait = Promise.all([set.desk, set.cover, set.clasp].map(one)).then(() => undefined);
    ready.set(set.name, wait);
  }
  return wait;
}
