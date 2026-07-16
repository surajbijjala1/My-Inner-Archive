/** A journal entry as returned by the backend. */
export interface Entry {
  id: string;
  username?: string;
  text: string;
  activity: string | null;
  mood: number | null;
  mood_label: string | null;
  mood_user: number | null;
  mood_user_label: string | null;
  created_at: string;
  is_favorite?: boolean;
}

/** Notification preferences (GET/POST /notifications/settings). */
export interface NotificationSettings {
  enabled: boolean;
  times: string[];
  timezone: string | null;
}

/** Partial mood fields returned by GET /entries/:id while scoring completes. */
export interface EntryMood {
  mood: number | null;
  mood_label: string | null;
  mood_user: number | null;
  mood_user_label: string | null;
}

/** A single chat turn. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** A stored chat message with its timestamp. */
export interface StoredChatMessage extends ChatMessage {
  created_at: string;
}

/** A chat session summary row. */
export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  /** Persona the session was started with (null for pre-persona sessions). */
  persona?: string | null;
  message_count: number;
}

/** Response from POST /ai/chat. `error` is set for the 402 free-limit case. */
export interface ChatReply {
  reply?: string;
  error?: string;
  chatCount?: number;
  freeLimit?: number;
  isOwner?: boolean;
  hasApiKey?: boolean;
}

/** Response from POST /ocr. */
export interface OcrResponse {
  text: string;
  engine: "gemini" | "tesseract";
  warning: "no_text" | "partial" | null;
}

/** One entry suggested by the bulk-import segmentation pass (POST /ocr/segment). */
export interface SegmentedEntry {
  text: string;
  tag: string;
  mood: number;
  date: string | null;
}

/** Response from GET /user/me. */
export interface UserProfile {
  username: string;
  isOwner: boolean;
  chatCount: number;
  freeLimit: number;
  hasApiKey: boolean;
  pinLength: number;
  customTags: string[];
  persona: string;
  customInstructions: string;
  freeRemaining: number | null;
}

/** Public persona metadata from GET /user/personas. */
export interface PersonaMeta {
  id: string;
  name: string;
  meaning: string;
  description: string;
  emoji: string;
  welcome: string;
  suggestions: string[];
}
