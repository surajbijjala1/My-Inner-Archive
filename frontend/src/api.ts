import type {
  ChatReply,
  ChatSession,
  Entry,
  EntryMood,
  FontPref,
  ThemePref,
  NotificationSettings,
  Patterns,
  OcrResponse,
  PersonaMeta,
  SegmentedEntry,
  StoredChatMessage,
  UserProfile,
} from "./types";

const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ─── Safe storage ────────────────────────────────────────────────────────────
// localStorage can throw (private mode, storage disabled or full, a locked-down
// WebView). None of that may take the app down, so every access goes through
// these: a failed read is "nothing stored", a failed write is dropped.
export function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* not stored — carry on */ }
}
export function storageRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* nothing to remove */ }
}

// ─── Token management ────────────────────────────────────────────────────────
export function getToken(): string | null { return storageGet("arc_token"); }
export function setToken(token: string): void { storageSet("arc_token", token); }
export function clearToken(): void { storageRemove("arc_token"); }
export function hasToken(): boolean { return !!storageGet("arc_token"); }

// ─── Username memory ─────────────────────────────────────────────────────────
export function getRememberedUsername(): string { return storageGet("arc_username") || ""; }
export function rememberUsername(u: string): void { storageSet("arc_username", u); }
export function forgetUsername(): void { storageRemove("arc_username"); }

// ─── Session memory ──────────────────────────────────────────────────────────
export function getStoredSessionId(): string | null { return storageGet("arc_session_id") || null; }
export function storeSessionId(id: string): void { storageSet("arc_session_id", id); }
export function clearSessionId(): void { storageRemove("arc_session_id"); }

// ─── Errors ──────────────────────────────────────────────────────────────────
/**
 * A failed request. `status` is the HTTP status, or 0 when no answer came back
 * at all (offline, dropped mid-request, server unreachable) — callers use it to
 * tell "you are signed out" from "try again in a moment".
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** True when the request never got an answer (as opposed to being refused). */
export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

const OFFLINE_MESSAGE = "Couldn't reach your archive — check your connection and try again.";

// The app registers one listener; it runs when a signed-in request comes back
// 401 (the 30-day token expired or was revoked), so every screen ends up at
// the sign-in page instead of each showing its own unexplained error.
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** Shared failure handling for a response that is not ok. Always throws. */
async function failFrom(res: Response, path: string, hadToken: boolean): Promise<never> {
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  // /auth/* answers 401 for a wrong PIN — that is not an expired session.
  if (res.status === 401 && hadToken && !path.startsWith("/auth/")) {
    onSessionExpired?.();
    throw new ApiError(401, "You've been signed out — sign in again to carry on.");
  }
  throw new ApiError(res.status, err.error || `Request failed (${res.status})`);
}

// ─── Authenticated fetch helper ──────────────────────────────────────────────
async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((options.headers as Record<string, string>) || {}),
      },
    });
  } catch {
    // fetch only rejects when nothing came back: offline, DNS, dropped mid-request.
    throw new ApiError(0, OFFLINE_MESSAGE);
  }

  // 402 free_limit_reached — return as resolved value, not thrown
  if (res.status === 402) return res.json() as Promise<T>;

  if (!res.ok) return failFrom(res, path, !!token);

  try {
    return (await res.json()) as T;
  } catch {
    // A 200 that isn't JSON (a proxy's error page, a body cut off mid-way).
    throw new ApiError(0, OFFLINE_MESSAGE);
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export async function register(username: string, pin: string, pinLength: number = 4): Promise<{ token: string }> {
  const data = await authFetch<{ token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, pin, pin_length: pinLength }),
  });
  setToken(data.token);
  rememberUsername(username);
  return data;
}

export async function login(username: string, pin: string): Promise<{ token: string; pin_length: number }> {
  const data = await authFetch<{ token: string; pin_length: number }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, pin }),
  });
  setToken(data.token);
  rememberUsername(username);
  return data;
}

export async function getPinLength(username: string): Promise<number> {
  if (!username) return 4;
  try {
    const data = await fetch(`${API_URL}/auth/pin-length?username=${encodeURIComponent(username)}`);
    const json = (await data.json()) as { pin_length?: number };
    return json.pin_length || 4;
  } catch {
    return 4;
  }
}

export async function checkUsername(username: string): Promise<{ available: boolean }> {
  if (!username?.trim()) return { available: false };
  try {
    const res = await fetch(`${API_URL}/auth/check-username?username=${encodeURIComponent(username.trim())}`);
    return (await res.json()) as { available: boolean };
  } catch {
    return { available: true }; // fail-open so registration can still attempt
  }
}

export async function changePin(currentPin: string, newPin: string): Promise<{ success: boolean }> {
  return authFetch("/auth/change-pin", {
    method: "POST",
    body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
  });
}

// ─── Entries ─────────────────────────────────────────────────────────────────
export async function getEntries(): Promise<Entry[]> { return authFetch("/entries"); }

export async function createEntry(text: string, activity: string, moodUser: number | null): Promise<Entry> {
  return authFetch("/entries", {
    method: "POST",
    body: JSON.stringify({ text, activity, mood_user: moodUser ?? null }),
  });
}

export async function deleteEntry(id: string): Promise<{ success: boolean }> {
  return authFetch(`/entries/${id}`, { method: "DELETE" });
}

export async function getEntryMood(entryId: string): Promise<EntryMood> {
  return authFetch(`/entries/${entryId}`);
}

export async function setEntryFavorite(id: string, isFavorite: boolean): Promise<{ id: string; is_favorite: boolean }> {
  return authFetch(`/entries/${id}/favorite`, {
    method: "PATCH",
    body: JSON.stringify({ is_favorite: isFavorite }),
  });
}

// ─── Notifications ────────────────────────────────────────────────────────────
export async function registerDeviceToken(token: string, platform: "android" | "ios"): Promise<{ success: boolean }> {
  return authFetch("/notifications/register", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return authFetch("/notifications/settings");
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<{ success: boolean }> {
  return authFetch("/notifications/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  });
}

// ─── User ─────────────────────────────────────────────────────────────────────
export async function getMe(): Promise<UserProfile> { return authFetch("/user/me"); }

export async function getPersonas(): Promise<{ personas: PersonaMeta[]; defaultPersona: string }> {
  return authFetch("/user/personas");
}

export async function setPersona(persona: string): Promise<{ success: boolean; persona: string }> {
  return authFetch("/user/persona", {
    method: "POST",
    body: JSON.stringify({ persona }),
  });
}

export async function saveInstructions(instructions: string): Promise<{ success: boolean }> {
  return authFetch("/user/instructions", {
    method: "POST",
    body: JSON.stringify({ instructions }),
  });
}

export async function saveApiKey(apiKey: string): Promise<{ success: boolean }> {
  return authFetch("/user/api-key", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export async function addTag(tag: string): Promise<{ tags: string[] }> {
  return authFetch("/user/tags", {
    method: "POST",
    body: JSON.stringify({ tag }),
  });
}

export async function removeTag(tag: string): Promise<{ tags: string[] }> {
  return authFetch(`/user/tags/${encodeURIComponent(tag)}`, { method: "DELETE" });
}

// ─── OCR (owner + own-key users only) ─────────────────────────────────────────
export async function ocrImage(imageBase64: string, mimeType: string): Promise<OcrResponse> {
  return authFetch("/ocr", {
    method: "POST",
    body: JSON.stringify({ image: imageBase64, mimeType }),
  });
}

export async function segmentText(text: string): Promise<{ entries: SegmentedEntry[] }> {
  return authFetch("/ocr/segment", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function createEntriesBatch(
  entries: { text: string; activity: string; mood: number; date: string | null }[]
): Promise<{ inserted: number; entries: Entry[] }> {
  return authFetch("/entries/batch", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────
// Only the new message travels over the wire — the server rebuilds the
// conversation history from the session's stored messages.
export async function sendChat(message: string, sessionId: string): Promise<ChatReply> {
  return authFetch("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId }),
  });
}

// ─── TTS (voice chat) ─────────────────────────────────────────────────────────
// Returns synthesized MP3 audio. Throws on any failure — callers fall back to
// on-device SpeechSynthesis (the backend voice service is free and unofficial).
export async function ttsSpeak(text: string, persona: string | null, signal?: AbortSignal): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${API_URL}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text, persona }),
    signal,
  });
  // An expired session still has to sign the user out; anything else just
  // falls back to the device's own voice.
  if (!res.ok) return failFrom(res, "/tts", !!token);
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("TTS returned empty audio");
  return blob;
}

// ─── Patterns ─────────────────────────────────────────────────────────────────
export async function getPatterns(days?: number): Promise<Patterns> {
  // The server groups entries into days in this zone, not its own.
  const params = new URLSearchParams({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (days) params.set("days", String(days));
  return authFetch(`/patterns?${params}`);
}

// ─── Reading preferences ──────────────────────────────────────────────────────
export async function setPreferences(prefs: {
  fontPref?: FontPref;
  lockOnClose?: boolean;
  theme?: ThemePref;
}): Promise<{ success: boolean }> {
  return authFetch("/user/preferences", {
    method: "POST",
    body: JSON.stringify(prefs),
  });
}

// ─── Chat Sessions ────────────────────────────────────────────────────────────
export async function createChatSession(): Promise<{ session_id: string; created_at: string; persona: string | null }> {
  return authFetch("/chats/session", { method: "POST" });
}

export async function getSessionMeta(
  sessionId: string
): Promise<{ id: string; title: string | null; created_at: string; persona: string | null }> {
  return authFetch(`/chats/sessions/${sessionId}`);
}

export async function getChatSessions(): Promise<ChatSession[]> {
  return authFetch("/chats/sessions");
}

export async function getChatMessages(sessionId: string): Promise<StoredChatMessage[]> {
  return authFetch(`/chats/sessions/${sessionId}/messages`);
}

export async function deleteChatSession(sessionId: string): Promise<{ success: boolean }> {
  return authFetch(`/chats/sessions/${sessionId}`, { method: "DELETE" });
}
