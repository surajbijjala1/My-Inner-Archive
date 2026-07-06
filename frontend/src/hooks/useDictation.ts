/**
 * useDictation — voice-to-text dictation for input boxes (Feature 9).
 * Web Speech API on web and Android WebView. Dictation only — not voice chat.
 *
 * Native Android may swap in @capacitor-community/speech-recognition in
 * Phase 3 behind the same hook interface.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { hasWebSpeech } from "../native";

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
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);
  const onFinalRef = useRef(onFinalText);
  useEffect(() => {
    onFinalRef.current = onFinalText;
  }, [onFinalText]);
  const supported = hasWebSpeech();

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (!supported) return;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition!;
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
      // "no-speech"/"aborted" are normal lifecycle noise, not user errors
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access denied. Allow it in your browser settings.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setError("Dictation failed. Please try again.");
      }
    };

    rec.onend = () => {
      // Fires on manual stop AND after the engine's own silence timeout
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
    };

    setError(null);
    setInterim("");
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [supported]);

  // Clean up if the component unmounts mid-dictation
  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, listening, interim, error, toggle, stop };
}
