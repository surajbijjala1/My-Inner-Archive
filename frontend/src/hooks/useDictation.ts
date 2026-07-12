/**
 * useDictation — voice-to-text dictation for input boxes (Feature 9).
 *
 * Two engines behind one interface:
 *  - Native Android (Capacitor): @capacitor-community/speech-recognition —
 *    the platform recognizer, noticeably more accurate than WebView Web Speech.
 *  - Web (and fallback): Web Speech API.
 *
 * Both engines AUTO-RESTART after the recognizer's own silence timeout, so a
 * pause in speech doesn't end dictation — only tapping the mic again does.
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
  /** Toggle listening on/off. */
  toggle: () => void;
  stop: () => void;
}

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

  // True while the user wants dictation on — drives auto-restart
  const activeRef = useRef(false);
  const webRecRef = useRef<WebSpeechRecognition | null>(null);
  // Latest partial from the native recognizer (committed on utterance end)
  const nativePartialRef = useRef("");

  const supported = isNativeApp() || hasWebSpeech();

  // ── Web engine ─────────────────────────────────────────────────────────────

  const startWeb = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
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
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access denied. Allow it in your browser settings.");
        activeRef.current = false;
      }
      // "no-speech"/"aborted"/"network" blips are handled by the restart loop
    };

    rec.onend = () => {
      webRecRef.current = null;
      setInterim("");
      if (activeRef.current) {
        // Recognizer hit its silence timeout — keep the session going
        startWeb();
      } else {
        setListening(false);
      }
    };

    webRecRef.current = rec;
    rec.start();
  }, []);

  const stopWeb = useCallback(() => {
    webRecRef.current?.stop();
  }, []);

  // ── Native engine (Android) ────────────────────────────────────────────────

  const startNative = useCallback(async () => {
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");

    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== "granted") {
      setError("Microphone access denied. Allow it in your device settings.");
      activeRef.current = false;
      setListening(false);
      return;
    }

    await SpeechRecognition.removeAllListeners();
    nativePartialRef.current = "";

    await SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
      const best = data.matches?.[0] ?? "";
      nativePartialRef.current = best;
      setInterim(best);
    });

    const listenOnce = async (): Promise<void> => {
      nativePartialRef.current = "";
      try {
        // Resolves when the platform recognizer ends the utterance (silence)
        const result = (await SpeechRecognition.start({
          language: navigator.language || "en-US",
          partialResults: true,
          popup: false,
        })) as { matches?: string[] } | undefined;

        const final = result?.matches?.[0] ?? nativePartialRef.current;
        if (final.trim()) onFinalRef.current(final.trim() + " ");
      } catch {
        // start() rejects on no-speech timeouts — fine, loop decides below
      }
      setInterim("");
      if (activeRef.current) {
        await listenOnce(); // auto-restart until the user taps stop
      } else {
        setListening(false);
      }
    };

    listenOnce();
  }, []);

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
    if (isNativeApp()) stopNative();
    else stopWeb();
  }, [stopNative, stopWeb]);

  const toggle = useCallback(() => {
    if (!supported) return;

    if (activeRef.current) {
      stop();
      return;
    }

    setError(null);
    setInterim("");
    activeRef.current = true;
    setListening(true);
    if (isNativeApp()) startNative();
    else startWeb();
  }, [supported, startNative, startWeb, stop]);

  // Clean up if the component unmounts mid-dictation
  useEffect(
    () => () => {
      activeRef.current = false;
      webRecRef.current?.abort();
      if (isNativeApp()) {
        import("@capacitor-community/speech-recognition")
          .then(({ SpeechRecognition }) => SpeechRecognition.stop())
          .catch(() => undefined);
      }
    },
    []
  );

  return { supported, listening, interim, error, toggle, stop };
}
