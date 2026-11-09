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
} as const;

/** Error message for an over-limit field, or null if within bounds. */
export function tooLong(value: string, max: number, label: string): string | null {
  return value.length > max
    ? `${label} is too long (${value.length.toLocaleString()} characters; the limit is ${max.toLocaleString()})`
    : null;
}
