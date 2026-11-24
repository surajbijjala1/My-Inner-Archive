import { useCallback, useEffect, useState } from "react";
import { COVER_OPEN_MS, SCENE_FADE_MS, prefersReducedMotion } from "../motion";
import { play } from "../sounds";
import type { Screen } from "./useArchiveSession";

/**
 * A cold start is the page (or the Android WebView) loading from nothing.
 * This flag is true from then until the archive has been opened once, or
 * locked; a module variable, because that is exactly its lifetime. Coming
 * back from the background reloads nothing, so it changes nothing.
 */
let coldStart = true;
/** The intro video plays once in a cold start, the first time the entry page is left. */
let introSeen = false;

/**
 * What the lock scene is doing:
 *   closed  — the book is shut on the desk (PIN ring, or waiting)
 *   opening — cold start only: the clasp opens and the cover swings into the app
 *   leaving — every other time: the scene fades away
 *   done    — the app is on its own
 */
export type SceneStage = "closed" | "opening" | "leaving" | "done";

/**
 * The entrance, and nothing else: the ink line, the entry page's video, the
 * book on the desk, its lettering being stamped, and the cover opening into
 * the app. All of it belongs to a cold start. After any lock the PIN screen
 * is simply there, and a correct PIN fades straight into the app. It decides
 * what is drawn over the app; it never decides which screen the session is on.
 */
export function useEntrance(screen: Screen) {
  const inApp = screen === "app";
  // The ink line: on a cold start only, and over whatever is loading beneath.
  // "fading" is its last moment, when what is beneath starts to show.
  const [splash, setSplash] = useState<"on" | "fading" | "off">(coldStart ? "on" : "off");
  // Whether the scene still gets to fade in. Ends with the intro.
  const [arrive, setArrive] = useState(coldStart);
  const [stage, setStage] = useState<SceneStage>("closed");
  // The video is on screen (from the tap until it has faded onto the lock scene).
  const [introPlaying, setIntroPlaying] = useState(false);
  // The lettering has yet to be stamped onto the cover.
  const [reveal, setReveal] = useState(false);

  // Leaving the app (lock, sign-out, an expired session) shuts the book
  // again, and from then on it is simply there.
  const [wasInApp, setWasInApp] = useState(inApp);
  if (wasInApp !== inApp) {
    setWasInApp(inApp);
    if (inApp) setArrive(false);
    else setStage("closed");
  }
  if (arrive && screen === "unreachable") setArrive(false);

  // The app is ready: open into it, once the ink line is out of the way.
  useEffect(() => {
    if (!inApp || splash !== "off") return;
    const swing = coldStart && !prefersReducedMotion();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts a timed animation in step with its timer
    setStage(swing ? "opening" : "leaving");
    if (coldStart) play("open");
    const timer = setTimeout(() => {
      coldStart = false;
      setStage("done");
    }, swing ? COVER_OPEN_MS : SCENE_FADE_MS);
    return () => clearTimeout(timer);
  }, [inApp, splash]);

  // "Couldn't reach your archive" offers a lock. Any lock ends the intro.
  useEffect(() => {
    if (screen === "unreachable") coldStart = false;
  }, [screen]);

  const fadeSplash = useCallback(() => setSplash((s) => (s === "on" ? "fading" : s)), []);
  const endSplash = useCallback(() => setSplash("off"), []);

  /** A tap during the cover's swing: straight to the app. */
  const skipOpening = useCallback(() => {
    coldStart = false;
    setStage("done");
  }, []);

  /** The entry page was left and the video has started. */
  const beginIntro = useCallback(() => {
    introSeen = true;
    setIntroPlaying(true);
  }, []);

  /** The video is over: the lock scene is showing, and its lettering arrives. */
  const endIntro = useCallback(() => {
    setIntroPlaying(false);
    setReveal(true);
  }, []);

  /** The entry page was left with no video (reduced motion, no file, or not a cold start). */
  const skipIntro = useCallback(() => {
    const first = coldStart && !introSeen;
    introSeen = true;
    setReveal(first);
  }, []);

  const endReveal = useCallback(() => setReveal(false), []);

  const sceneStage: SceneStage = inApp ? stage : "closed";

  return {
    splash: splash !== "off",
    fadeSplash,
    endSplash,
    /** The scene fades in as the ink line clears (cold start only). */
    arrive: arrive && splash !== "on",
    stage: sceneStage,
    skipOpening,
    /** The video should be standing by (cold start, entry page) or is playing. */
    introWanted: introPlaying || (coldStart && !introSeen && screen === "welcome" && !prefersReducedMotion()),
    introPlaying,
    beginIntro,
    endIntro,
    skipIntro,
    reveal,
    endReveal,
  };
}
