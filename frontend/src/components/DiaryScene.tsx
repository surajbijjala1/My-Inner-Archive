import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { COVER_OPEN_MS, SCENE_FADE_MS } from "../motion";
import { openBook } from "../openBook";
import type { SceneStage } from "../hooks/useEntrance";
import coverUrl from "../assets/scene/cover.webp";
import lampUrl from "../assets/scene/lamp.webp";
import claspUrl from "../assets/scene/clasp.webp";

interface DiarySceneProps {
  /** "diary": the locked book on the desk. "landing": the desk and lamp alone, with words on it. */
  variant: "diary" | "landing";
  stage: Exclude<SceneStage, "done">;
  /** Cold start: the scene settles in. Otherwise it is simply there. */
  arrive: boolean;
  /** 0–1: how much of the PIN has been typed. The lamp brightens with it. */
  glow?: number;
  /** A tap while the book is opening. */
  onSkip: () => void;
  /** On the desk above the book (or, on the landing page, everything). */
  head?: ReactNode;
  /** On the book's cover: the name label and the brass plate. */
  cover?: ReactNode;
  /** On the desk below the book. */
  foot?: ReactNode;
}

/**
 * The desk, the lamp and the book lying on it.
 *
 * The book, the lamp and the clasp are photographs (src/assets/scene, see
 * its README); the desk is a generated wood texture; the light is drawn over
 * all of it, so the lamp really does decide what can be seen: a warm pool in
 * a dark room, or daylight with the lamp merely on. The lamp is lighting
 * only. The PIN pad is real, live DOM set into the cover.
 *
 * When the PIN is right the scene hands over to openBook(), which opens the
 * cover onto the app that is already drawn beneath.
 */
export default function DiaryScene({
  variant, stage, arrive, glow = 0, onSkip, head, cover, foot,
}: DiarySceneProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  // The book is shown once its photograph has arrived, rather than popping in.
  const [coverReady, setCoverReady] = useState(false);
  const [lampReady, setLampReady] = useState(false);

  useLayoutEffect(() => {
    if (stage !== "opening" || !sceneRef.current) return;
    return openBook(sceneRef.current);
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
      ref={sceneRef}
      className={`scene scene--${stage} scene--${variant}${arrive ? " scene--arrive" : ""}`}
      style={vars}
      onPointerDown={stage === "opening" ? onSkip : undefined}
      aria-hidden={passing || undefined}
      inert={passing}
    >
      <div className="scene-desk desk-surface" aria-hidden="true" />
      <img
        className={`scene-lamp${lampReady ? " scene-lamp--ready" : ""}`}
        src={lampUrl}
        alt=""
        decoding="async"
        draggable={false}
        onLoad={() => setLampReady(true)}
        onError={() => setLampReady(true)}
      />

      <div className="scene-col">
        {head && <div className="scene-head">{head}</div>}

        {variant === "diary" && (
          <div className={`diary${coverReady ? " diary--ready" : ""}`}>
            <div className="diary-shadow" aria-hidden="true" />
            <div className="diary-block" aria-hidden="true" />
            <div className="diary-leaf">
              <div className="diary-back" aria-hidden="true" />
              <div className="diary-front">
                <img
                  className="diary-cover"
                  src={coverUrl}
                  alt=""
                  decoding="async"
                  draggable={false}
                  onLoad={() => setCoverReady(true)}
                  onError={() => setCoverReady(true)}
                />
                <div className="diary-on">{cover}</div>
                <img className="diary-clasp" src={claspUrl} alt="" decoding="async" draggable={false} />
              </div>
            </div>
          </div>
        )}

        {foot && <div className="scene-foot">{foot}</div>}
      </div>

      {/* The light: what the lamp leaves dark, and the warmth where it falls. */}
      <div className="scene-shade" aria-hidden="true" />
      <div className="scene-warm" aria-hidden="true" />
    </div>
  );
}

/** What the cover carries while a signed-in archive is being fetched. */
export function CoverWait() {
  return (
    <div className="pin-lock pin-lock--wait" role="status">
      <svg className="pin-keyhole" width="26" height="38" viewBox="0 0 30 42" aria-hidden="true">
        <path d="M15 3a9.5 9.5 0 0 1 5.2 17.4L23.5 38h-17l3.3-17.6A9.5 9.5 0 0 1 15 3Z" />
      </svg>
      <span className="pin-wait-word loading-pulse">one moment&hellip;</span>
    </div>
  );
}
