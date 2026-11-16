/**
 * Light, dark, or whatever the device is set to.
 *
 * The choice (`ThemePref`) is stored on the account (users.theme) so it
 * follows you between devices, and mirrored here in localStorage so the
 * sign-in screens — before there is an account to ask — open in the right
 * colours. What the page actually shows (`ResolvedTheme`) is written to
 * <html data-theme> and `color-scheme`, which index.css keys off.
 *
 * The very first paint is handled by a tiny inline script in index.html that
 * does the same thing as `applyTheme(readStoredTheme())`, before any CSS or
 * JS loads; keep the two in step (key name and values).
 */

import { useEffect, useState } from "react";
import { storageGet, storageSet } from "./api";
import { isNativeApp } from "./native";
import type { ThemePref } from "./types";

export type { ThemePref };
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];
export const THEME_KEY = "arc_theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The browser-chrome colour for each theme (the paper, as hex). */
const META_COLOUR: Record<ResolvedTheme, string> = { light: "#f2efe9", dark: "#1e1813" };

export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === "string" && (THEME_PREFS as readonly string[]).includes(value);
}

/** The stored choice; "system" when there is none, it is unreadable, or storage throws. */
export function readStoredTheme(): ThemePref {
  const raw = storageGet(THEME_KEY);
  return isThemePref(raw) ? raw : "system";
}

export function storeTheme(pref: ThemePref): void {
  storageSet(THEME_KEY, pref);
}

/** Whether the OS asks for dark. False if the query can't be answered. */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/** Put a theme on the page: <html data-theme>, color-scheme, browser chrome and Android's bars. */
export function applyTheme(pref: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(pref, systemPrefersDark());
  const root = document.documentElement;
  // index.css sets color-scheme from this attribute, so native controls and
  // scrollbars follow too.
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && meta.content !== META_COLOUR[resolved]) meta.content = META_COLOUR[resolved];

  if (isNativeApp()) void styleSystemBars(resolved);
  return resolved;
}

/**
 * Android: the status and navigation bars sit over the page (Capacitor 8 is
 * edge-to-edge), so only their icons need to change — light icons on the
 * night page, dark ones on paper. SystemBars ships with @capacitor/core.
 */
async function styleSystemBars(resolved: ResolvedTheme): Promise<void> {
  try {
    const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");
    await SystemBars.setStyle({ style: resolved === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch {
    // Older shell without the plugin: the bars keep their default look.
  }
}

/**
 * Apply `pref` now and, while it is "system", again whenever the OS switches.
 * Returns the cleanup.
 */
export function followTheme(pref: ThemePref): () => void {
  applyTheme(pref);
  if (pref !== "system") return () => {};
  let query: MediaQueryList;
  try {
    query = window.matchMedia(DARK_QUERY);
  } catch {
    return () => {};
  }
  const onChange = () => applyTheme("system");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The theme the page is showing right now, kept current — for colours drawn in code. */
export function useResolvedTheme(): ResolvedTheme {
  const read = (): ResolvedTheme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState<ResolvedTheme>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
