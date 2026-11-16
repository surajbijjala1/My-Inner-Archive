/**
 * The archive's few sounds: short, quiet, and never in the way.
 *
 * Plays through the Web Audio API rather than <audio> elements: iOS Safari
 * ignores HTMLAudioElement.volume (every clip would play at full volume), and
 * Web Audio is the one path that unlocks reliably on the first tap in both
 * the Android WebView and iOS Safari, then plays overlapping clips without
 * stutter.
 *
 * Guarantees, so callers can fire and forget:
 *   - play() never throws and never blocks (no await needed, nothing returned);
 *   - nothing plays before the first user gesture (the AudioContext is only
 *     created inside one), while the page is hidden, when sound is switched
 *     off, or when a clip is missing or can't be decoded;
 *   - clips load lazily: after the unlock, in idle time, only the enabled ones.
 *
 * Settings are per device (localStorage `arc_sounds`): a phone in a quiet
 * room and a laptop with headphones can reasonably differ.
 */

import { useSyncExternalStore } from "react";
import { storageGet, storageSet } from "./api";

import openUrl from "./assets/sounds/open.wav";
import saveUrl from "./assets/sounds/save.wav";
import tearUrl from "./assets/sounds/tear.wav";
import chatSendUrl from "./assets/sounds/chat-send.wav";
import chatReceiveUrl from "./assets/sounds/chat-receive.wav";
import navigateUrl from "./assets/sounds/navigate.wav";
import pageUrl from "./assets/sounds/page.wav";

export type SoundName = "open" | "save" | "tear" | "chatSend" | "chatReceive" | "navigate" | "page";

/** What the Settings sheet offers a switch for. `page` follows the master switch only. */
export type SoundToggle = "save" | "tear" | "chat" | "navigate" | "open";

export interface SoundSettings {
  master: boolean;
  save: boolean;
  tear: boolean;
  chat: boolean;
  navigate: boolean;
  open: boolean;
}

/** The one place loudness is set: every clip plays at MASTER_VOLUME × its own gain. */
export const MASTER_VOLUME = 0.35;

const CLIP_GAIN: Record<SoundName, number> = {
  open: 0.8,
  save: 0.7,
  tear: 0.7,
  chatSend: 0.45,
  chatReceive: 0.45,
  // On by default but very quiet: it plays every time you change page.
  navigate: 0.2,
  page: 0.6,
};

const CLIP_URL: Record<SoundName, string> = {
  open: openUrl,
  save: saveUrl,
  tear: tearUrl,
  chatSend: chatSendUrl,
  chatReceive: chatReceiveUrl,
  navigate: navigateUrl,
  page: pageUrl,
};

const TOGGLE_FOR: Record<SoundName, SoundToggle | null> = {
  open: "open",
  save: "save",
  tear: "tear",
  chatSend: "chat",
  chatReceive: "chat",
  navigate: "navigate",
  page: null,
};

const SETTINGS_KEY = "arc_sounds";

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  master: true,
  save: true,
  tear: true,
  chat: true,
  navigate: true,
  open: true,
};

// ── Settings ────────────────────────────────────────────────────────────────

function readSettings(): SoundSettings {
  const raw = storageGet(SETTINGS_KEY);
  if (!raw) return DEFAULT_SOUND_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof SoundSettings, unknown>> | null;
    const merged = { ...DEFAULT_SOUND_SETTINGS };
    for (const key of Object.keys(merged) as (keyof SoundSettings)[]) {
      if (parsed && typeof parsed[key] === "boolean") merged[key] = parsed[key] as boolean;
    }
    return merged;
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

let settings: SoundSettings | null = null;
const listeners = new Set<() => void>();

export function getSoundSettings(): SoundSettings {
  if (!settings) settings = readSettings();
  return settings;
}

export function setSoundSettings(patch: Partial<SoundSettings>): void {
  settings = { ...getSoundSettings(), ...patch };
  storageSet(SETTINGS_KEY, JSON.stringify(settings));
  listeners.forEach((l) => l());
  if (!settings.master) return;
  // Turning sound on is itself a tap, so it can unlock audio straight away.
  if (unlocked) preloadEnabled();
  else unlock();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current settings, re-rendering when they change. */
export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(subscribe, getSoundSettings);
}

function isEnabled(name: SoundName): boolean {
  const s = getSoundSettings();
  const toggle = TOGGLE_FOR[name];
  return s.master && (toggle === null || s[toggle]);
}

// ── Audio ───────────────────────────────────────────────────────────────────

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let unlocked = false;
let installed = false;
const buffers = new Map<SoundName, Promise<AudioBuffer | null>>();
const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

const pageVisible = (): boolean => document.visibilityState === "visible";

/** Runs inside the first user gesture: the only moment browsers allow audio to start. */
function unlock(): void {
  if (unlocked) return;
  // Sound off: leave the context uncreated, and keep listening for the
  // gesture that turns it on (the switch itself is one).
  if (!getSoundSettings().master) return;
  try {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    ctx = new Ctor();
    void ctx.resume().catch(() => {});
    // iOS only counts the context as unlocked once something has played in a gesture.
    const blip = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = blip;
    source.connect(ctx.destination);
    source.start(0);
    unlocked = true;
    for (const g of GESTURES) window.removeEventListener(g, unlock, true);
    preloadEnabled();
  } catch {
    ctx = null;
  }
}

function load(name: SoundName): Promise<AudioBuffer | null> {
  const cached = buffers.get(name);
  if (cached) return cached;
  const context = ctx;
  if (!context) return Promise.resolve(null);
  const pending = fetch(CLIP_URL[name])
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .then((data) =>
      data
        ? // The callback form also covers older Safari, whose decodeAudioData returns nothing.
          new Promise<AudioBuffer | null>((resolve) => {
            try {
              const result = context.decodeAudioData(data, resolve, () => resolve(null));
              if (result && typeof result.catch === "function") result.catch(() => resolve(null));
            } catch {
              resolve(null);
            }
          })
        : null
    )
    .catch(() => null);
  buffers.set(name, pending);
  return pending;
}

function preloadEnabled(): void {
  const run = () => {
    for (const name of Object.keys(CLIP_URL) as SoundName[]) {
      if (isEnabled(name)) void load(name);
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(run);
  else setTimeout(run, 200);
}

/** Install the gesture unlock and the hidden-page pause. Call once, at start-up. */
export function initSounds(): void {
  if (installed) return;
  installed = true;
  try {
    for (const g of GESTURES) window.addEventListener(g, unlock, true);
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (pageVisible()) void ctx.resume().catch(() => {});
      else void ctx.suspend().catch(() => {});
    });
  } catch {
    // No listeners, no sound: the app is unaffected.
  }
}

/** Play a sound if it is switched on and the page is in view. Fire and forget. */
export function play(name: SoundName): void {
  try {
    if (!isEnabled(name) || !pageVisible() || !unlocked || !ctx) return;
    const context = ctx;
    if (context.state === "suspended") void context.resume().catch(() => {});
    void load(name)
      .then((buffer) => {
        if (!buffer || !pageVisible() || !isEnabled(name)) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = MASTER_VOLUME * CLIP_GAIN[name];
        source.connect(gain).connect(context.destination);
        source.start(0);
      })
      .catch(() => {});
  } catch {
    // Sound is decoration: never let it break what triggered it.
  }
}
