/**
 * The unsent draft in the writing view, kept on this device so a crash, a
 * reload or an expired session doesn't lose words that exist nowhere else.
 *
 * It is the one piece of journal text the app stores locally, so it is kept
 * for as short a time as possible: cleared when the entry is saved, when the
 * writing view is dismissed, and on lock / sign-out. It is tagged with its
 * owner and only ever handed back to that same user, so it can't surface for
 * someone else who signs in on the same device.
 *
 * Every access is wrapped (via the storage helpers): if storage is
 * unavailable the draft simply isn't protected — writing still works.
 */

import { storageGet, storageRemove, storageSet } from "./api";

const KEY = "arc_draft";

interface StoredDraft {
  owner: string;
  text: string;
}

/** The stored draft for this user, or "" when there is none (or it is someone else's). */
export function loadDraft(owner: string): string {
  if (!owner) return "";
  const raw = storageGet(KEY);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (parsed && parsed.owner === owner && typeof parsed.text === "string") return parsed.text;
  } catch {
    // Unreadable — treat as no draft.
  }
  return "";
}

/** Keep the draft; an empty one is removed rather than stored. */
export function saveDraft(owner: string, text: string): void {
  if (!owner) return;
  if (!text.trim()) {
    clearDraft();
    return;
  }
  storageSet(KEY, JSON.stringify({ owner, text } satisfies StoredDraft));
}

export function clearDraft(): void {
  storageRemove(KEY);
}

/** Whether a draft is waiting for this user — used to word the crash screen truthfully. */
export function hasDraft(owner: string): boolean {
  return loadDraft(owner).trim().length > 0;
}
