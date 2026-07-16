import type {
  ChatReply,
  ChatSession,
  Entry,
  EntryMood,
  NotificationSettings,
  OcrResponse,
  PersonaMeta,
  SegmentedEntry,
  StoredChatMessage,
  UserProfile,
} from "./types";

const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ─── Token management ────────────────────────────────────────────────────────
export function getToken(): string | null { return localStorage.getItem("arc_token"); }
export function setToken(token: string): void { localStorage.setItem("arc_token", token); }
export function clearToken(): void { localStorage.removeItem("arc_token"); }
export function hasToken(): boolean { return !!localStorage.getItem("arc_token"); }

// ─── Username memory ─────────────────────────────────────────────────────────
export function getRememberedUsername(): string { return localStorage.getItem("arc_username") || ""; }
export function rememberUsername(u: string): void { localStorage.setItem("arc_username", u); }

// ─── Session memory ──────────────────────────────────────────────────────────
export function getStoredSessionId(): string | null { return localStorage.getItem("arc_session_id") || null; }
export function storeSessionId(id: string): void { localStorage.setItem("arc_session_id", id); }
export function clearSessionId(): void { localStorage.removeItem("arc_session_id"); }


// ─── Authenticated fetch helper ──────────────────────────────────────────────
async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  // 402 free_limit_reached — return as resolved value, not thrown
  if (res.status === 402) return res.json() as Promise<T>;

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Request failed" }))) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
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
