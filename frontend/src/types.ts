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

/** Response from GET /user/me. */
export interface UserProfile {
  username: string;
  isOwner: boolean;
  chatCount: number;
  freeLimit: number;
  hasApiKey: boolean;
  pinLength: number;
  customTags: string[];
  freeRemaining: number | null;
}
