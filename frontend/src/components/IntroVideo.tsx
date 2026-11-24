import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { INTRO_FADE_MS, INTRO_PULL_BACK_MS, INTRO_START_WAIT_MS, INTRO_STALL_MS } from "../motion";
import { getSoundSettings } from "../sounds";
import { sceneReady, type SceneSet } from "../scene/introAssets";

export interface IntroHandle {
  /**
   * Show the first frame and start playing. Must be called from inside a
   * tap, so the browser allows sound. False if there is nothing to play.
   */
  start: () => boolean;
}

interface IntroVideoProps {
  ref: Ref<IntroHandle>;
  scene: SceneSet;
  /** How much larger than the lock scene the video is shown while it plays (≥ 1). */
  zoom: number;
  /** The video is over (ended, skipped, or failed) and has faded away. */
  onDone: () => void;
}

/**
 * The intro video: the desk, then down onto the closed book.
 *
 * It waits unseen from the entry page on, already fetching, so that the tap
 * on "Get Started" can start it at once and with its sound. What it shows
 * first is a still of its own first frame, so there is never a blank screen;
 * what lies beneath it is the live lock scene, which is the video's last
 * frame, so when the video ends it only has to fade.
 *
 * Anything that goes wrong (sound refused, a slow or broken file, a stall)
 * ends the same way: fade to the lock scene.
 */
export default function IntroVideo({ ref, scene, zoom, onDone }: IntroVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"waiting" | "showing" | "leaving">("waiting");
  // Fetch the video only once the entry page has drawn.
  const [armed, setArmed] = useState(false);
  const [moving, setMoving] = useState(false);
  const pulledBack = useRef(false);
  // The frame's edges fade into the desk only once it draws back and the
  // desk shows round it. While it fills the screen they must not: the desk
  // behind is the LAST frame, and would show through over the room.
  const [inset, setInset] = useState(false);
  const guard = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const clearGuard = () => {
    if (guard.current) clearTimeout(guard.current);
    guard.current = null;
  };

  /**
   * Ending, however it ends: fade onto the lock scene, but not before its
   * pictures are ready (a skip a moment in can beat them), and never wait
   * on them for long.
   */
  const leaving = useRef(false);
  const finish = () => {
    clearGuard();
    if (leaving.current) return;
    leaving.current = true;
    const go = () => setPhase((p) => (p === "showing" ? "leaving" : p));
    const cap = setTimeout(go, INTRO_START_WAIT_MS / 2);
    void sceneReady(scene).then(() => {
      clearTimeout(cap);
      go();
    });
  };

  /** If nothing moves for this long, stop waiting for it. */
  const watch = (ms: number) => {
    clearGuard();
    guard.current = setTimeout(finish, ms);
  };

  useImperativeHandle(ref, () => ({
    start: () => {
      const video = videoRef.current;
      if (!video || !scene.video) return false;
      if (!video.src) video.src = scene.video;
      const sounds = getSoundSettings();
      video.muted = !(sounds.master && sounds.open);
      setPhase("showing");
      watch(INTRO_START_WAIT_MS);
      const failed = () => finish();
      try {
        video.play().catch(() => {
          // Sound was refused: play it silent instead.
          video.muted = true;
          return video.play();
        }).catch(failed);
      } catch {
        failed();
      }
      return true;
    },
  }));

  // Leaving: fade the sound with the picture, then say so.
  useEffect(() => {
    if (phase !== "leaving") return;
    const video = videoRef.current;
    const from = video ? video.volume : 0;
    const began = performance.now();
    const fade = setInterval(() => {
      if (!video) return;
      video.volume = Math.max(0, from * (1 - (performance.now() - began) / INTRO_FADE_MS));
    }, 40);
    const timer = setTimeout(() => {
      clearInterval(fade);
      video?.pause();
      onDone();
    }, INTRO_FADE_MS);
    return () => {
      clearInterval(fade);
      clearTimeout(timer);
    };
  }, [phase, onDone]);

  useEffect(() => clearGuard, []);

  /**
   * Where the 16:9 frame cannot cover the window with the whole book in
   * view, the video plays covering the window and draws back to the lock
   * scene's size over its last moments, while the camera is already still.
   */
  const onTime = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    if (phase === "showing" && !video.paused) watch(INTRO_STALL_MS);
    const left = (video.duration - video.currentTime) * 1000;
    if (zoom <= 1.001 || pulledBack.current || left > INTRO_PULL_BACK_MS) return;
    pulledBack.current = true;
    setInset(true);
    stageRef.current?.animate(
      [{ transform: `scale(${zoom})` }, { transform: "scale(1)" }],
      { duration: Math.max(200, left), easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" }
    );
  };

  return (
    <div
      className={`intro desk-surface intro--${phase}${inset ? " intro--inset" : ""}`}
      style={{ "--intro-fade": `${INTRO_FADE_MS}ms` } as React.CSSProperties}
      onPointerDown={phase === "showing" ? finish : undefined}
      aria-hidden="true"
    >
      <div className="intro-stage" ref={stageRef}>
        {scene.poster && (
          <img
            className={`intro-poster${moving ? " intro-poster--under" : ""}`}
            src={scene.poster}
            alt=""
            decoding="async"
            draggable={false}
          />
        )}
        <video
          ref={videoRef}
          className={`intro-video${moving ? " intro-video--on" : ""}`}
          src={armed ? scene.video : undefined}
          preload="auto"
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          onPlaying={() => {
            setMoving(true);
            watch(INTRO_STALL_MS);
          }}
          onTimeUpdate={onTime}
          onEnded={finish}
          onError={() => { if (phase === "showing") finish(); }}
        />
      </div>
    </div>
  );
}
