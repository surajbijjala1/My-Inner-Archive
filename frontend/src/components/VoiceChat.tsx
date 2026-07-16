/**
 * VoiceChat — hands-free voice conversation overlay (Phase 4 MVP).
 *
 * Flow: listen (STT via useDictation) → silence auto-sends the transcript
 * through the normal chat pipeline → reply is spoken (backend msedge-tts,
 * falling back to on-device SpeechSynthesis) → listening resumes.
 *
 * Tap the orb to interrupt: while speaking it stops playback and listens;
 * while listening it sends immediately (or pauses if nothing was said).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDictation } from "../hooks/useDictation";
import { ttsSpeak } from "../api";
import type { PersonaMeta } from "../types";

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

/** How long after the last finalized utterance before we auto-send. */
const SILENCE_SEND_MS = 1800;

interface VoiceChatProps {
  persona: PersonaMeta | null;
  /** Sends through the normal chat pipeline; resolves with the reply (null on failure). */
  onSend: (text: string) => Promise<string | null>;
  onClose: () => void;
}

/** Markdown + emoji make awkward listening — strip them before synthesis. */
function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-•]\s*/gm, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\uFE0F|\u200D/g, "") // variation selectors + zero-width joiners
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function VoiceChat({ persona, onSend, onClose }: VoiceChatProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const stateRef = useRef<VoiceState>("idle");
  const bufferRef = useRef("");
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closedRef = useRef(false);

  const setVoiceState = (s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  };

  const clearSilenceTimer = () => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  };

  const stopAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }, []);

  // ── STT ────────────────────────────────────────────────────────────────────

  const sendBufferRef = useRef<() => void>(() => undefined);

  const dictation = useDictation((finalText) => {
    if (stateRef.current !== "listening") return;
    bufferRef.current += finalText;
    setTranscript(bufferRef.current.trim());
    clearSilenceTimer();
    silenceTimer.current = setTimeout(() => sendBufferRef.current(), SILENCE_SEND_MS);
  });

  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;

  const startListening = useCallback(() => {
    if (closedRef.current) return;
    stopAudio();
    bufferRef.current = "";
    setTranscript("");
    setNotice(null);
    setVoiceState("listening");
    if (!dictationRef.current.listening) dictationRef.current.toggle();
  }, [stopAudio]);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    if (dictationRef.current.listening) dictationRef.current.stop();
  }, []);

  // ── Speak a reply ──────────────────────────────────────────────────────────

  const speak = useCallback(
    async (reply: string) => {
      const speech = stripForSpeech(reply);
      if (!speech || closedRef.current) {
        startListening();
        return;
      }
      setVoiceState("speaking");

      // Primary: backend Edge-TTS stream
      try {
        const abort = new AbortController();
        abortRef.current = abort;
        const blob = await ttsSpeak(speech, persona?.id ?? null, abort.signal);
        if (closedRef.current || stateRef.current !== "speaking") return;

        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (!closedRef.current && stateRef.current === "speaking") startListening();
        };
        await audio.play();
        return;
      } catch {
        // fall through to SpeechSynthesis
      }

      // Fallback: on-device synthesis
      if (closedRef.current || stateRef.current !== "speaking") return;
      if (window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(speech);
        const voices = window.speechSynthesis.getVoices();
        utter.voice =
          voices.find((v) => v.lang === "en-IN") ??
          voices.find((v) => v.lang.startsWith("en")) ??
          null;
        utter.onend = () => {
          if (!closedRef.current && stateRef.current === "speaking") startListening();
        };
        utter.onerror = () => {
          if (!closedRef.current && stateRef.current === "speaking") startListening();
        };
        window.speechSynthesis.speak(utter);
      } else {
        setNotice("Voice playback isn't available here — reply shown below.");
        startListening();
      }
    },
    [persona?.id, startListening]
  );

  // ── Send the buffered transcript ───────────────────────────────────────────

  const sendBuffer = useCallback(async () => {
    clearSilenceTimer();
    const text = bufferRef.current.trim();
    if (!text || stateRef.current !== "listening") return;

    stopListening();
    setVoiceState("thinking");
    bufferRef.current = "";

    const reply = await onSend(text);
    if (closedRef.current) return;

    if (reply == null) {
      setNotice("Couldn't send that — tap the orb to try again.");
      setVoiceState("idle");
      return;
    }
    setLastReply(reply);
    speak(reply);
  }, [onSend, speak, stopListening]);

  useEffect(() => {
    sendBufferRef.current = sendBuffer;
  }, [sendBuffer]);

  // ── Orb tap = universal control ────────────────────────────────────────────

  const handleOrbTap = () => {
    switch (stateRef.current) {
      case "idle":
        startListening();
        break;
      case "listening":
        if (bufferRef.current.trim()) sendBuffer();
        else {
          stopListening();
          setVoiceState("idle");
        }
        break;
      case "speaking":
        // barge-in: stop the reply, listen again
        startListening();
        break;
      case "thinking":
        break; // nothing sensible to do mid-request
    }
  };

  // Start listening as soon as the overlay opens
  useEffect(() => {
    startListening();
    return () => {
      closedRef.current = true;
      clearSilenceTimer();
      dictationRef.current.stop();
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel: Record<VoiceState, string> = {
    idle: "Tap the orb to talk",
    listening: "Listening…",
    thinking: `${persona?.name ?? "Companion"} is thinking…`,
    speaking: `${persona?.name ?? "Companion"} is speaking — tap to interrupt`,
  };

  const liveText =
    state === "listening"
      ? [transcript, dictation.interim].filter(Boolean).join(" ")
      : state === "speaking" || state === "thinking"
        ? transcript
        : "";

  if (!dictation.supported) {
    return (
      <div className="voice-overlay" onClick={onClose}>
        <div className="voice-panel" onClick={(e) => e.stopPropagation()}>
          <div className="voice-status">
            Voice input isn't supported in this browser. Try Chrome, or the Android app.
          </div>
          <button className="voice-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-overlay">
      <div className="voice-panel">
        <div className="voice-persona">
          {persona ? `${persona.emoji} ${persona.name}` : "Your companion"}
        </div>

        <button
          className={`voice-orb voice-orb--${state}`}
          onClick={handleOrbTap}
          aria-label={statusLabel[state]}
        >
          {state === "thinking" ? "…" : "🎙"}
        </button>

        <div className="voice-status">{dictation.error ?? notice ?? statusLabel[state]}</div>

        {liveText && <div className="voice-transcript">“{liveText}”</div>}
        {state === "speaking" && lastReply && (
          <div className="voice-reply">{stripForSpeech(lastReply)}</div>
        )}

        <button className="voice-close-btn" onClick={onClose}>✕ End voice chat</button>
      </div>
    </div>
  );
}
