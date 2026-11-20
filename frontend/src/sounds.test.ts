import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * sounds.ts keeps its AudioContext and settings at module level, so every test
 * gets a fresh copy of the module and a fresh fake Web Audio.
 */

interface Played {
  gain: number;
}

function fakeWebAudio() {
  const played: Played[] = [];
  let created = 0;
  class FakeAudioContext {
    state = "running";
    destination = {};
    constructor() { created++; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    createBuffer() { return {}; }
    decodeAudioData(_data: ArrayBuffer, ok: (b: object) => void) { ok({}); return Promise.resolve({}); }
    createGain() {
      const node = { gain: { value: 1 }, connect: (next: unknown) => next };
      return node;
    }
    createBufferSource() {
      // A clip goes source → gain → destination. The unlock "blip" goes
      // straight to the destination and isn't counted as a sound.
      let next: { gain?: { value: number } } | null = null;
      return {
        buffer: null as unknown,
        connect(node: { gain?: { value: number } }) { next = node; return node; },
        start() { if (next?.gain) played.push({ gain: +next.gain.value.toFixed(3) }); },
      };
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return { played, created: () => created };
}

function fakeClips(ok = true) {
  const fetchMock = vi.fn(async () =>
    ok ? new Response(new ArrayBuffer(8)) : new Response(null, { status: 404 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

/** The first tap: the only moment browsers let audio start. */
const tap = () => window.dispatchEvent(new Event("pointerdown"));

/** Let the clip's fetch and decode finish. */
const settle = () => new Promise((r) => setTimeout(r, 30));

// Listeners each fresh copy of the module adds, so the next test starts clean.
const added: [EventTarget, string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];

async function freshSounds() {
  vi.resetModules();
  const sounds = await import("./sounds");
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      if (listener) added.push([target, type, listener, options]);
      original(type, listener, options);
    });
  }
  sounds.initSounds();
  return sounds;
}

afterEach(() => {
  for (const [target, type, listener, options] of added.splice(0)) {
    target.removeEventListener(type, listener, options);
  }
});

beforeEach(() => {
  setVisibility("visible");
});

describe("sounds", () => {
  it("plays nothing, and creates no AudioContext, before the first gesture", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    const { play } = await freshSounds();
    play("save");
    await settle();
    expect(audio.created()).toBe(0);
    expect(audio.played).toHaveLength(0);
  });

  it("unlocks on the first gesture and plays at the master × clip volume", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    const { play, MASTER_VOLUME } = await freshSounds();
    tap();
    expect(audio.created()).toBe(1);
    play("save");
    await settle();
    expect(audio.played).toEqual([{ gain: +(MASTER_VOLUME * 0.7).toFixed(3) }]);
  });

  it("keeps navigate very quiet", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    const { play } = await freshSounds();
    tap();
    play("navigate");
    play("save");
    await settle();
    const [navigate, save] = audio.played.map((p) => p.gain);
    expect(navigate).toBeLessThan(save / 3);
  });

  it("is silent when the master switch is off", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    const { play, setSoundSettings } = await freshSounds();
    tap();
    setSoundSettings({ master: false });
    play("save");
    play("tear");
    play("chatSend");
    play("page");
    await settle();
    expect(audio.played).toHaveLength(0);
  });

  it("is silent for a sound switched off on its own, and only that one", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    const { play, setSoundSettings } = await freshSounds();
    tap();
    setSoundSettings({ chat: false });
    play("chatSend");
    play("chatReceive");
    play("save");
    await settle();
    expect(audio.played).toHaveLength(1);
  });

  it("creates no AudioContext on a gesture while sound is off", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    localStorage.setItem("arc_sounds", JSON.stringify({ master: false }));
    await freshSounds();
    tap();
    expect(audio.created()).toBe(0);
  });

  it("is silent while the page is hidden", async () => {
    const audio = fakeWebAudio();
    fakeClips();
    const { play } = await freshSounds();
    tap();
    setVisibility("hidden");
    play("save");
    await settle();
    expect(audio.played).toHaveLength(0);
  });

  it("is silent, and does not throw, when a clip is missing", async () => {
    const audio = fakeWebAudio();
    fakeClips(false);
    const { play } = await freshSounds();
    tap();
    expect(() => play("tear")).not.toThrow();
    await settle();
    expect(audio.played).toHaveLength(0);
  });

  it("does not throw when the clip can't be fetched at all", async () => {
    fakeWebAudio();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const { play } = await freshSounds();
    tap();
    expect(() => play("save")).not.toThrow();
    await settle();
  });

  it("does not throw when there is no Web Audio at all", async () => {
    vi.stubGlobal("AudioContext", undefined);
    fakeClips();
    const { play } = await freshSounds();
    expect(() => { tap(); play("save"); }).not.toThrow();
  });

  it("does not throw when creating the AudioContext fails", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("NotAllowedError"); } });
    fakeClips();
    const { play } = await freshSounds();
    expect(() => { tap(); play("save"); }).not.toThrow();
  });

  it("defaults to everything on", async () => {
    const { getSoundSettings, DEFAULT_SOUND_SETTINGS } = await freshSounds();
    expect(getSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(Object.values(DEFAULT_SOUND_SETTINGS).every(Boolean)).toBe(true);
  });

  it("remembers settings on the device and keeps unknown or bad values out", async () => {
    let sounds = await freshSounds();
    sounds.setSoundSettings({ navigate: false });
    expect(JSON.parse(localStorage.getItem("arc_sounds")!)).toMatchObject({ navigate: false, master: true });

    localStorage.setItem("arc_sounds", JSON.stringify({ save: "no", tear: false, extra: true }));
    sounds = await freshSounds();
    expect(sounds.getSoundSettings()).toEqual({ ...sounds.DEFAULT_SOUND_SETTINGS, tear: false });
  });

  it("falls back to the defaults when the stored settings are unreadable", async () => {
    localStorage.setItem("arc_sounds", "{not json");
    const { getSoundSettings, DEFAULT_SOUND_SETTINGS } = await freshSounds();
    expect(getSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });
});
