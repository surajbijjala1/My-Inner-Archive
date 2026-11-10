/**
 * useDictation — voice-to-text for the journal line and the voice chat.
 *
 * Two engines behind one interface:
 *  - Native Android (Capacitor): @capacitor-community/speech-recognition —
 *    the platform recognizer, noticeably more accurate than WebView Web Speech.
 *  - Web (and fallback): Web Speech API.
 *
 * Both keep listening across pauses: when the recognizer ends an utterance on
 * its own, the words are committed and listening starts again. Only stop()
 * (or unmount) ends a session.
 *
 * Native engine, and why it polls: with partial results on, the plugin's
 * start() resolves IMMEDIATELY, not when the utterance ends — and when the
 * recognizer gives up on silence it tells JS nothing at all. The old loop
 * treated that early resolve as "utterance over" and called start() again at
 * once; each start() destroys and recreates the Android recognizer, so it
 * never heard a word. The session below waits on the recognizer's own
 * listening flag instead, and commits the last transcript when it drops.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { hasWebSpeech, isNativeApp } from "../native";

// Minimal typings for the vendor-prefixed Web Speech API
interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  }
}

export interface DictationState {
  /** Whether dictation is available on this device/browser. */
  supported: boolean;
  /** Currently listening. */
  listening: boolean;
  /** Live (interim) transcript for visual feedback while speaking. */
  interim: string;
  /** Error message for the user, if any. */
  error: string | null;
  /** Start listening; does nothing if already listening. */
  start: () => void;
  /** Toggle listening on/off. */
  toggle: () => void;
  stop: () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How often the native session checks whether the recognizer is still listening. */
const NATIVE_POLL_MS = 300;
/** The final result lands just after the recognizer stops listening. */
const NATIVE_SETTLE_MS = 400;
/** Recognizer cycles shorter than this with no words count as failures. */
const QUICK_FAIL_MS = 1200;
const MAX_QUICK_FAILS = 4;

/** Web Speech errors that won't fix themselves by restarting. */
const WEB_FATAL: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser settings.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser settings.",
  "audio-capture": "No microphone found.",
  network: "Voice input couldn't reach the speech service. Check your connection and try again.",
  "language-not-supported": "Voice input doesn't support this language here.",
};

/**
 * @param onFinalText called with each finalized utterance (append to your field)
 */
export function useDictation(onFinalText: (text: string) => void): DictationState {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onFinalRef = useRef(onFinalText);
  useEffect(() => {
    onFinalRef.current = onFinalText;
  }, [onFinalText]);

  // True while the user wants dictation on — drives the restart loops.
  const activeRef = useRef(false);
  // Bumped by every start and by unmount, so a session that has been
  // superseded (or whose component is gone) stops touching state.
  const genRef = useRef(0);
  const webRecRef = useRef<WebSpeechRecognition | null>(null);
  // Latest transcript from the native recognizer, committed when it stops.
  const nativeTextRef = useRef("");
  // The Android recognizer is one shared object; only the hook instance that
  // last started it may stop it on unmount (a hidden copy of the journal form
  // unmounting must not cut off the voice chat).
  const ownsNativeRef = useRef(false);

  const supported = isNativeApp() || hasWebSpeech();

  const fail = useCallback((message: string) => {
    activeRef.current = false;
    setError(message);
    setInterim("");
    setListening(false);
  }, []);

  // ── Web engine ─────────────────────────────────────────────────────────────

  const startWeb = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      fail("Voice input isn't available in this browser. Try Chrome.");
      return;
    }

    // A session that is still winding down from stop() is dropped outright;
    // its late onend is ignored below because it is no longer the current one.
    webRecRef.current?.abort();

    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      if (webRecRef.current !== rec) return;
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim();
          if (t) onFinalRef.current(t + " ");
        } else {
          interimText += r[0].transcript;
        }
      }
      setInterim(interimText);
    };

    rec.onerror = (e) => {
      if (webRecRef.current !== rec) return;
      const message = WEB_FATAL[e.error];
      if (message) {
        activeRef.current = false;
        setError(message);
      }
      // "no-speech" / "aborted" blips: onend follows and the loop restarts
    };

    rec.onend = () => {
      if (webRecRef.current !== rec) return; // superseded by a newer session
      webRecRef.current = null;
      setInterim("");
      if (activeRef.current) {
        startWeb(); // the recognizer hit its own silence timeout — keep going
      } else {
        setListening(false);
      }
    };

    webRecRef.current = rec;
    try {
      rec.start();
    } catch {
      webRecRef.current = null;
      fail("Couldn't start the microphone. Please try again.");
    }
  }, [fail]);

  const stopWeb = useCallback(() => {
    webRecRef.current?.stop();
  }, []);

  // ── Native engine (Android) ────────────────────────────────────────────────

  const startNative = useCallback(async (gen: number) => {
    const live = () => genRef.current === gen;
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");

    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        if (live()) fail("Speech recognition isn't available on this phone (it needs Google's speech services).");
        return;
      }
      const perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== "granted") {
        if (live()) fail("Microphone access is blocked. Allow it for this app in your phone's settings.");
        return;
      }
      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
        if (!live()) return;
        const best = data.matches?.[0] ?? "";
        nativeTextRef.current = best;
        setInterim(best);
      });
    } catch (e) {
      if (live()) fail(`Couldn't start voice input: ${(e as Error).message || "unknown error"}`);
      return;
    }

    let quickFails = 0;
    while (live() && activeRef.current) {
      nativeTextRef.current = "";
      const began = Date.now();
      try {
        // Resolves as soon as the recognizer is listening (partial results on).
        await SpeechRecognition.start({
          language: navigator.language || "en-US",
          partialResults: true,
          popup: false,
        });
      } catch (e) {
        if (live()) fail(`Couldn't start the microphone: ${(e as Error).message || "unknown error"}`);
        return;
      }

      // Wait for this utterance to end: end of speech, a silence/no-match
      // error, or stop(). All of them drop the plugin's listening flag.
      for (;;) {
        await sleep(NATIVE_POLL_MS);
        if (!live()) return;
        try {
          const { listening: still } = await SpeechRecognition.isListening();
          if (!still) break;
        } catch {
          break;
        }
      }

      await sleep(NATIVE_SETTLE_MS);
      if (!live()) return;
      const text = nativeTextRef.current.trim();
      nativeTextRef.current = "";
      setInterim("");
      if (text) onFinalRef.current(text + " ");

      // A recognizer that ends straight away with nothing heard is erroring
      // (busy, no network, no speech service). Back off, then give up and say so.
      if (!text && Date.now() - began < QUICK_FAIL_MS) {
        quickFails++;
        if (quickFails >= MAX_QUICK_FAILS) {
          fail("Voice input stopped responding. Tap the mic to try again.");
          return;
        }
        await sleep(400 * quickFails);
      } else {
        quickFails = 0;
      }
    }

    if (live()) setListening(false);
  }, [fail]);

  const stopNative = useCallback(async () => {
    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      await SpeechRecognition.stop();
    } catch {
      // already stopped
    }
  }, []);

  // ── Public controls ────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    activeRef.current = false;
    if (isNativeApp()) {
      // The session loop notices, commits what was heard, and ends itself.
      stopNative();
    } else {
      stopWeb();
    }
  }, [stopNative, stopWeb]);

  const start = useCallback(() => {
    if (!supported || activeRef.current) return;
    setError(null);
    setInterim("");
    activeRef.current = true;
    setListening(true);
    const gen = ++genRef.current;
    if (isNativeApp()) {
      ownsNativeRef.current = true;
      startNative(gen);
    } else {
      startWeb();
    }
  }, [supported, startNative, startWeb]);

  const toggle = useCallback(() => {
    if (activeRef.current) stop();
    else start();
  }, [start, stop]);

  // Stop everything if the component unmounts mid-dictation. Resetting the
  // visible state too matters under React's dev double-mount, where the
  // component survives this cleanup and must not believe it is still listening.
  useEffect(
    () => () => {
      activeRef.current = false;
      genRef.current++;
      const rec = webRecRef.current;
      webRecRef.current = null;
      rec?.abort();
      setListening(false);
      setInterim("");
      if (isNativeApp() && ownsNativeRef.current) {
        ownsNativeRef.current = false;
        import("@capacitor-community/speech-recognition")
          .then(({ SpeechRecognition }) => {
            SpeechRecognition.stop().catch(() => undefined);
            SpeechRecognition.removeAllListeners().catch(() => undefined);
          })
          .catch(() => undefined);
      }
    },
    []
  );

  return { supported, listening, interim, error, start, toggle, stop };
}
