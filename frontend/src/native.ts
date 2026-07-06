/**
 * native.ts
 * Capability detection — the single seam between web and the Capacitor APK.
 * No code forking: features probe here and pick the right implementation.
 * (Capacitor plugins get wired in Phase 3; on the web these all report false.)
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

/** True when running inside the Capacitor Android/iOS shell. */
export function isNativeApp(): boolean {
  return !!window.Capacitor?.isNativePlatform?.();
}

/** "web" | "android" | "ios" */
export function getPlatform(): string {
  return window.Capacitor?.getPlatform?.() ?? "web";
}

/** Web Speech API availability (works on web Chrome and Android WebView). */
export function hasWebSpeech(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
