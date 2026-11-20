import { describe, expect, it, vi } from "vitest";
import {
  applyTheme, followTheme, isThemePref, readStoredTheme, resolveTheme, storeTheme,
  systemPrefersDark, THEME_KEY,
} from "./theme";

/** A stand-in for matchMedia whose answer can be flipped, like the OS switching. */
function fakeSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() { return dark; },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    flip(next: boolean) { dark = next; listeners.forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
}

const themeOnPage = () => document.documentElement.dataset.theme;

describe("resolveTheme", () => {
  it("follows the device when the choice is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the device when light or dark is chosen", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("the stored choice", () => {
  it("round-trips through storage", () => {
    storeTheme("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("falls back to system when nothing is stored", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("falls back to system when the stored value is not a theme", () => {
    localStorage.setItem(THEME_KEY, "purple");
    expect(readStoredTheme()).toBe("system");
  });

  it("falls back to system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStoredTheme()).toBe("system");
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => storeTheme("light")).not.toThrow();
  });

  it("recognises only the three choices", () => {
    expect(["system", "light", "dark"].every(isThemePref)).toBe(true);
    expect(isThemePref("Dark")).toBe(false);
    expect(isThemePref(undefined)).toBe(false);
  });
});

describe("systemPrefersDark", () => {
  it("reads the OS preference", () => {
    fakeSystem(true);
    expect(systemPrefersDark()).toBe(true);
  });

  it("treats a matchMedia that throws as light", () => {
    vi.stubGlobal("matchMedia", () => { throw new Error("unsupported"); });
    expect(systemPrefersDark()).toBe(false);
  });
});

describe("applyTheme", () => {
  it("writes the resolved theme to <html> and the browser chrome colour", () => {
    fakeSystem(false);
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
    try {
      expect(applyTheme("dark")).toBe("dark");
      expect(themeOnPage()).toBe("dark");
      expect(meta.content).toBe("#1e1813");
      applyTheme("light");
      expect(themeOnPage()).toBe("light");
      expect(meta.content).toBe("#f2efe9");
    } finally {
      meta.remove();
    }
  });
});

describe("followTheme", () => {
  it("follows the OS live while the choice is system", () => {
    const system = fakeSystem(false);
    const stop = followTheme("system");
    expect(themeOnPage()).toBe("light");
    system.flip(true);
    expect(themeOnPage()).toBe("dark");
    system.flip(false);
    expect(themeOnPage()).toBe("light");
    stop();
    expect(system.listenerCount()).toBe(0);
  });

  it("does not listen to the OS when a theme is chosen", () => {
    const system = fakeSystem(false);
    followTheme("dark");
    expect(themeOnPage()).toBe("dark");
    system.flip(false);
    expect(themeOnPage()).toBe("dark");
    expect(system.listenerCount()).toBe(0);
  });
});
