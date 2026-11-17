import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { CLASP_STEP_MS, COVER_OPEN_MS, SCENE_FADE_MS } from "../motion";
import { openBook } from "../openBook";
import { stampFoil } from "../foilReveal";
import type { SceneStage } from "../hooks/useEntrance";

/**
 * The clasp's swing, as the opening has always swung it (openBook.ts): up
 * about its pivot to this angle with every digit in, then on to let go.
 */
const CLASP_TYPED_DEG = 34;

interface DiarySceneProps {
  stage: Exclude<SceneStage, "done">;
  /** Cold start: the scene fades in. Otherwise it is simply there. */
  arrive: boolean;
  /** 0–1: how much of the PIN has been typed. The clasp lifts with it, a step a digit. */
  clasp?: number;
  /** The lettering has yet to be stamped onto the cover: do it now. */
  reveal?: boolean;
  onRevealed?: () => void;
  /** A tap while the book is opening. */
  onSkip: () => void;
  /** On the book's cover: the name, the ring of digits, the links. */
  cover?: ReactNode;
  /** On the desk at the book's foot: the slip an error is written on. */
  foot?: ReactNode;
}

/**
 * The closed book on the desk: the intro video's last frame, taken apart.
 *
 * The desk, the book and its clasp are three pieces cut from that frame
 * (src/assets/intro) and laid back exactly where they were, by the placement
 * in scene/useSceneFrame.ts, so this scene and the end of the video are the
 * same picture. Taken apart, the clasp can lift and the cover can open.
 * Everything written on the cover is real, live DOM.
 *
 * When the PIN is right the scene hands over to openBook(), which opens the
 * cover onto the app that is already drawn beneath.
 */
export default function DiaryScene({
  stage, arrive, clasp = 0, reveal = false, onRevealed, onSkip, cover, foot,
}: DiarySceneProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (stage !== "opening" || !sceneRef.current) return;
    return openBook(sceneRef.current);
  }, [stage]);

  // Stamp the lettering once, when this scene first shows it.
  const revealOnce = useRef(reveal);
  useLayoutEffect(() => {
    if (!revealOnce.current || !sceneRef.current) return;
    onRevealed?.();
    return stampFoil(sceneRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the archive is opening, nothing in the scene can be pressed or read out.
  const passing = stage !== "closed";
  const lift = passing ? 1 : Math.min(1, Math.max(0, clasp));

  const vars = {
    "--clasp-deg": `${lift * CLASP_TYPED_DEG}deg`,
    "--clasp-lift": lift,
    "--clasp-ms": `${CLASP_STEP_MS}ms`,
    "--open-ms": `${COVER_OPEN_MS}ms`,
    "--leave-ms": `${SCENE_FADE_MS}ms`,
  } as CSSProperties;

  return (
    <div
      ref={sceneRef}
      className={`scene scene--${stage}${arrive ? " scene--arrive" : ""}`}
      style={vars}
      onPointerDown={stage === "opening" ? onSkip : undefined}
      aria-hidden={passing || undefined}
      inert={passing}
    >
      <div className="scene-desk desk-surface" aria-hidden="true" />

      <div className="diary">
        <div className="diary-block" aria-hidden="true" />
        <div className="diary-leaf">
          <div className="diary-back" aria-hidden="true" />
          <div className="diary-front">
            <div className="diary-cover" aria-hidden="true" />
            <div className="diary-on">{cover}</div>
          </div>
        </div>
        {/* The clasp: it swings open a step with every digit of the PIN. */}
        <div className="diary-clasp" aria-hidden="true" />
      </div>

      {foot && <div className="scene-foot">{foot}</div>}
    </div>
  );
}

/** What the cover carries while a signed-in archive is being fetched. */
export function CoverWait() {
  return (
    <div className="pin-wait" role="status">
      <span className="foil loading-pulse">one moment&hellip;</span>
    </div>
  );
}
