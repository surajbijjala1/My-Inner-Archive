import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { SPLASH_FADE_MS, SPLASH_WRITE_MS, prefersReducedMotion } from "../motion";

const LINE = "this page is only yours";
const LETTERS = [...LINE];
/** The pen starts a beat after the page appears and rests a beat at the end. */
const LEAD_MS = 180;
const REST_MS = 420;
const PER_LETTER_MS = (SPLASH_WRITE_MS - LEAD_MS - REST_MS) / LETTERS.length;
/** Don't hold the line back for a slow font: write in the fallback hand instead. */
const FONT_WAIT_MS = 350;

interface InkSplashProps {
  /** The line starts to fade: what is beneath begins to show. */
  onFade: () => void;
  /** The line is gone. */
  onDone: () => void;
}

/**
 * The first thing on a cold start: one line, written across plain paper in
 * the interface's own hand, then gone. Any tap or key skips it. It sits over
 * whatever is loading beneath, so it costs no time.
 *
 * Each letter is uncovered left to right in turn (a clip, not a layout
 * change), which reads as a pen moving; the underline is a real drawn stroke.
 */
export default function InkSplash({ onFade, onDone }: InkSplashProps) {
  const [phase, setPhase] = useState<"wait" | "write" | "fade">("wait");

  // Start writing once the handwriting font is in (or after a short wait).
  useEffect(() => {
    let live = true;
    const start = () => {
      if (live) setPhase((p) => (p === "wait" ? "write" : p));
    };
    const timer = setTimeout(start, FONT_WAIT_MS);
    try {
      void document.fonts.load("44px Caveat").then(start, start);
    } catch {
      // No Font Loading API: the timer starts it.
    }
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (phase === "wait") return;
    if (phase === "write") {
      const timer = setTimeout(
        () => setPhase("fade"),
        prefersReducedMotion() ? 1100 : SPLASH_WRITE_MS
      );
      return () => clearTimeout(timer);
    }
    onFade();
    const timer = setTimeout(onDone, SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, onFade, onDone]);

  // Any tap or key skips. Captured, so the press doesn't also reach the page beneath.
  useEffect(() => {
    const skip = (ev: Event) => {
      ev.stopPropagation();
      setPhase("fade");
    };
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skip, true);
    return () => {
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skip, true);
    };
  }, []);

  return (
    <div className={`ink-splash paper ink-splash--${phase}`} role="img" aria-label={LINE}>
      <div className="ink-line" aria-hidden="true">
        <span className="ink-words">
          {LETTERS.map((ch, i) => (
            <span
              key={i}
              className="ink-letter"
              style={{ "--ink-delay": `${Math.round(LEAD_MS + i * PER_LETTER_MS)}ms` } as CSSProperties}
            >
              {ch === " " ? " " : ch}
            </span>
          ))}
        </span>
        <svg className="ink-rule" viewBox="0 0 300 14" preserveAspectRatio="none">
          <path
            pathLength={1}
            style={{ "--ink-delay": `${SPLASH_WRITE_MS - REST_MS - 120}ms` } as CSSProperties}
            d="M4 8.5 C 46 4.5, 92 10.5, 142 7 S 236 3.5, 296 7.5"
          />
        </svg>
      </div>
    </div>
  );
}
