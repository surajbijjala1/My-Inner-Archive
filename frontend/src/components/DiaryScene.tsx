import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { COVER_OPEN_MS, SCENE_FADE_MS } from "../motion";
import type { SceneStage } from "../hooks/useEntrance";

interface DiarySceneProps {
  /** "diary": the locked book (PIN pad or waiting). "sheet": a loose page on the desk (welcome). */
  variant: "diary" | "sheet";
  stage: Exclude<SceneStage, "done">;
  /** Cold start: the diary settles onto the desk. Otherwise it is simply there. */
  arrive: boolean;
  /** 0–1: how much of the PIN has been typed. The lamp brightens with it. */
  glow?: number;
  /** A tap while the cover is swinging open. */
  onSkip: () => void;
  children: ReactNode;
}

/** The lamp over the desk: lighting only, so it is drawn and nothing more. */
const Lamp = () => (
  <svg className="scene-lamp" viewBox="0 0 220 150" aria-hidden="true">
    <path className="scene-lamp-arm" d="M188 -6 L150 46" />
    <path className="scene-lamp-shade" d="M112 30 L170 22 L196 96 L72 112 Z" />
    <path className="scene-lamp-rim" d="M72 112 Q134 122 196 96" />
    <ellipse className="scene-lamp-bulb" cx="134" cy="107" rx="46" ry="9" transform="rotate(-7.3 134 107)" />
  </svg>
);

/**
 * The desk, the lamp and the diary lying on it. The diary's cover carries
 * whatever it is given (the PIN pad lives in its brass lock).
 *
 * Opening: the diary slides and grows until its page block sits exactly on
 * the app's own page (the chat page of the open book on a wide screen, the
 * whole page on a phone) while the cover swings over on its spine. The desk
 * fades, then the diary's paper fades, and what is left is the app, already
 * there beneath it. Transform and opacity only.
 */
export default function DiaryScene({ variant, stage, arrive, glow = 0, onSkip, children }: DiarySceneProps) {
  const diaryRef = useRef<HTMLDivElement | null>(null);

  // Where the page block has to land: measured once, as the opening starts.
  useLayoutEffect(() => {
    const diary = diaryRef.current;
    if (stage !== "opening" || !diary) return;
    const page = [...document.querySelectorAll<HTMLElement>("[data-book-landing]")].find(
      (el) => el.getClientRects().length > 0
    );
    const from = diary.getBoundingClientRect();
    const to = page?.getBoundingClientRect();
    if (!to || from.width === 0 || from.height === 0) return;
    diary.style.setProperty("--land-x", `${to.left - from.left}px`);
    diary.style.setProperty("--land-y", `${to.top - from.top}px`);
    diary.style.setProperty("--land-sx", String(to.width / from.width));
    diary.style.setProperty("--land-sy", String(to.height / from.height));
  }, [stage]);

  const vars = {
    "--glow": glow,
    "--open-ms": `${COVER_OPEN_MS}ms`,
    "--leave-ms": `${SCENE_FADE_MS}ms`,
  } as CSSProperties;

  // Once the archive is opening, nothing in the scene can be pressed or read out.
  const passing = stage !== "closed";

  return (
    <div
      className={`scene scene--${stage}${arrive ? " scene--arrive" : ""}`}
      style={vars}
      onPointerDown={stage === "opening" ? onSkip : undefined}
      aria-hidden={passing || undefined}
      inert={passing}
    >
      <div className="scene-desk" aria-hidden="true" />
      <div className="scene-light" aria-hidden="true" />
      <div className="scene-light scene-light--pin" aria-hidden="true" />
      <Lamp />

      {variant === "sheet" ? (
        <div className="scene-sheet paper">{children}</div>
      ) : (
        <div className="diary" ref={diaryRef}>
          <div className="diary-block" aria-hidden="true" />
          <div className="diary-pages" aria-hidden="true" />
          <div className="diary-cover">
            <div className="diary-face diary-face--back" aria-hidden="true" />
            <div className="diary-face diary-face--front">
              <div className="diary-stitch" aria-hidden="true" />
              <div className="diary-strap" aria-hidden="true">
                <span className="diary-strap-tip" />
              </div>
              <div className="diary-content">{children}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What the cover shows while a signed-in archive is being fetched: the lock, and a word. */
export function CoverWait() {
  return (
    <div className="pin-wrap pin-wrap--wait">
      <div className="pin-title">My Inner Archive</div>
      <div className="pin-lock pin-lock--wait" role="status">
        <svg className="pin-keyhole" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
          <path d="M15 3a9.5 9.5 0 0 1 5.2 17.4L23.5 38h-17l3.3-17.6A9.5 9.5 0 0 1 15 3Z" />
        </svg>
        <span className="pin-subtitle pin-subtitle--prompt loading-pulse">one moment&hellip;</span>
      </div>
    </div>
  );
}
