/**
 * limits.ts
 * Size caps for user-supplied text. Without them, the only ceiling was the 2 MB
 * JSON body limit — a single entry or chat message could be megabytes, every
 * byte of it re-sent to Gemini (embedding, mood scoring, chat history) on the
 * shared trial key.
 *
 * Set well above real use: at the time of writing the longest entry was ~1.4k
 * characters and the longest chat message ~1.2k.
 */

export const LIMITS = {
  /** One journal entry, including OCR'd pages from bulk import. */
  entryChars: 20_000,
  /** An entry's activity tag (emoji prefix + label). */
  activityChars: 60,
  /** One chat message from the user. */
  chatMessageChars: 8_000,
  /** OCR'd page text sent for segmentation. */
  ocrTextChars: 50_000,
  usernameMinChars: 2,
  usernameMaxChars: 32,
  /** An FCM registration token. Real ones are a few hundred characters. */
  deviceTokenChars: 4096,
} as const;

/** A PIN as the keypads produce it: a string of exactly `length` digits. */
export function isPin(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[0-9]+$/.test(value);
}

/** Control characters, zero-width characters and bidi overrides. */
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;

/**
 * True when a username contains characters nobody can see. Usernames are
 * written into log lines (`user=...`) — a newline in one forges log entries —
 * and an invisible character makes a second account that reads identically
 * to an existing one.
 */
export function hasInvisibleChars(value: string): boolean {
  return INVISIBLE_CHARS.test(value);
}

/**
 * A caller-supplied request id, if it is safe to echo into a response header,
 * log lines and trace attributes; otherwise null (the caller generates one).
 */
export function safeRequestId(header: unknown): string | null {
  return typeof header === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(header) ? header : null;
}

/** Error message for an over-limit field, or null if within bounds. */
export function tooLong(value: string, max: number, label: string): string | null {
  return value.length > max
    ? `${label} is too long (${value.length.toLocaleString()} characters; the limit is ${max.toLocaleString()})`
    : null;
}
