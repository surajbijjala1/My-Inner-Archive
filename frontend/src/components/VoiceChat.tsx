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

/** Longest clip sent for synthesis after the first. */
const CLIP_MAX = 240;

/**
 * Splits speech into clips at sentence ends: the first clip is one sentence
 * (so playback starts fast), later ones group sentences up to CLIP_MAX.
 * A run-on sentence longer than that is cut at a word boundary.
 */
function chunkForSpeech(text: string): string[] {
  const sentences = (text.match(/[^.!?\u2026]+(?:[.!?\u2026]+["'\u201d\u2019)\]]*|$)/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      const parts: string[] = [];
      let rest = s;
      while (rest.length > CLIP_MAX) {
        const cut = rest.lastIndexOf(" ", CLIP_MAX);
        const at = cut > 40 ? cut : CLIP_MAX;
        parts.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) parts.push(rest);
      return parts;
    });

  const clips: string[] = [];
  let current = "";
  for (const s of sentences) {
    const limit = clips.length === 0 ? 0 : CLIP_MAX; // first clip: one sentence alone
    if (current && current.length + 1 + s.length > limit) {
      clips.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) clips.push(current);
  return clips.length ? clips : [text];
}

/** Inked to match the action bar's microphone. */
const MicIcon = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
    <rect x="9.5" y="3.5" width="5" height="9.5" rx="2.5" />
    <path d="M6.6 11.2c.2 3 2.6 5.2 5.4 5.2s5.2-2.2 5.4-5.2" />
    <line x1="12" y1="16.6" x2="12" y2="20" />
  </svg>
);

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
    dictationRef.current.start(); // no-op if it is already listening
  }, [stopAudio]);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    dictationRef.current.stop();
  }, []);

  // ── Speak a reply ──────────────────────────────────────────────────────────

  /** On-device synthesis: the fallback when the persona voice can't be fetched or played. */
  const speakOnDevice = useCallback(
    (text: string) => {
      if (closedRef.current || stateRef.current !== "speaking") return;
      if (!text.trim()) {
        startListening();
        return;
      }
      if (!window.speechSynthesis) {
        setNotice("Voice playback isn't available here — the reply is shown below.");
        startListening();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      utter.voice =
        voices.find((v) => v.lang === "en-IN") ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
      const resume = () => {
        if (!closedRef.current && stateRef.current === "speaking") startListening();
      };
      utter.onend = resume;
      utter.onerror = resume;
      window.speechSynthesis.speak(utter);
    },
    [startListening]
  );

  /** Plays one clip; resolves true when it finishes, false if it fails or is interrupted. */
  const playClip = useCallback((blob: Blob, signal: AbortSignal): Promise<boolean> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const done = (ok: boolean) => {
        signal.removeEventListener("abort", onAbort);
        audio.onended = null;
        audio.onerror = null;
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        resolve(ok);
      };
      const onAbort = () => done(false);
      signal.addEventListener("abort", onAbort);
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.play().catch(() => done(false));
    });
  }, []);

  /**
   * Speaks the reply in the persona's voice, a sentence or two at a time: the
   * first clip is a single sentence so the voice starts within a couple of
   * seconds. All clips (2–4 for a typical reply) are requested at once, so the
   * next one is ready before the current one ends.
   * (Fetching the whole reply first meant ~20s of silence on a long answer.)
   * Any failure hands the rest of the reply to on-device synthesis.
   */
  const speak = useCallback(
    async (reply: string) => {
      const speech = stripForSpeech(reply);
      if (!speech || closedRef.current) {
        startListening();
        return;
      }
      setVoiceState("speaking");

      const abort = new AbortController();
      abortRef.current = abort;
      const stillSpeaking = () =>
        !closedRef.current && stateRef.current === "speaking" && !abort.signal.aborted;

      const chunks = chunkForSpeech(speech);
      const fetchClip = (text: string) => {
        const p = ttsSpeak(text, persona?.id ?? null, abort.signal);
        p.catch(() => undefined); // awaited below; this only silences the unhandled warning
        return p;
      };

      const clips = chunks.map(fetchClip);
      for (let i = 0; i < chunks.length; i++) {
        let blob: Blob;
        try {
          blob = await clips[i];
        } catch {
          if (stillSpeaking()) speakOnDevice(chunks.slice(i).join(" "));
          return;
        }
        if (!stillSpeaking()) return;
        const played = await playClip(blob, abort.signal);
        if (!stillSpeaking()) return;
        if (!played) {
          speakOnDevice(chunks.slice(i).join(" "));
          return;
        }
      }
      startListening();
    },
    [persona?.id, startListening, speakOnDevice, playClip]
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

  // Start listening as soon as the overlay opens. closedRef is reset here, not
  // only at creation: React's dev double-mount runs the cleanup below once
  // before the real mount, and a stale `true` left the overlay showing
  // "listening…" with the microphone already shut off.
  useEffect(() => {
    closedRef.current = false;
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
    idle: "tap to talk",
    listening: "listening…",
    thinking: `${persona?.name ?? "your companion"} is thinking…`,
    speaking: `${persona?.name ?? "your companion"} is speaking — tap to interrupt`,
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
          <button className="sheet-btn" onClick={onClose}>close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-overlay">
      <div className="voice-panel">
        <div className="voice-persona">{persona ? persona.name : "your companion"}</div>

        <button
          className={`voice-orb voice-orb--${state}`}
          onClick={handleOrbTap}
          aria-label={statusLabel[state]}
        >
          {state === "thinking" ? <span className="voice-dots" aria-hidden="true">…</span> : <MicIcon />}
        </button>

        <div className="voice-status">{dictation.error ?? notice ?? statusLabel[state]}</div>

        {liveText && <div className="voice-transcript">“{liveText}”</div>}
        {state === "speaking" && lastReply && (
          <div className="voice-reply">{stripForSpeech(lastReply)}</div>
        )}

        <button className="sheet-btn" onClick={onClose}>end voice chat</button>
      </div>
    </div>
  );
}
