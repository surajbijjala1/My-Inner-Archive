import { useCallback, useEffect, useRef, useState } from "react";
import { createEntry, deleteEntry, getEntries } from "../api";
import { clearDraft } from "../draft";
import { delay, haptic, prefersReducedMotion, tearDuration, TEAR_TREMBLE_MS } from "../motion";
import { play } from "../sounds";
import type { Entry, EntryMood } from "../types";

/** Entries written on today's date in earlier years. */
function onThisDayIn(all: Entry[]): Entry[] {
  const now = new Date();
  return all.filter((e) => {
    const d = new Date(e.created_at);
    return (
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate() &&
      d.getFullYear() < now.getFullYear()
    );
  });
}

export interface Tearing {
  id: string;
  phase: "pending" | "ripping";
}

/**
 * The journal's data and the state of the page around it: the entries, the
 * writing view, the entry waiting to be torn out, and the highlighted line.
 */
export function useJournal(showNotice: (text: string) => void) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [onThisDay, setOnThisDay] = useState<Entry[]>([]);
  // Writing is its own view in the design, reached with "+", not a form
  // permanently pinned above the journal.
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<Entry | null>(null);
  // The entry being torn out: it trembles while the server is asked
  // ("pending"), and rips away only once the server has said yes ("ripping").
  const [tearing, setTearing] = useState<Tearing | null>(null);
  const tearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Highlight one entry for a few seconds (a notification tap, a day opened from Patterns). */
  const flashEntry = useCallback((id: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setHighlightEntryId(id);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setHighlightEntryId(null);
    }, 4000);
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (tearTimer.current) clearTimeout(tearTimer.current);
  }, []);

  /** Replace the list and recompute "on this day" from it. */
  const replaceEntries = useCallback((all: Entry[]) => {
    setEntries(all);
    setOnThisDay(onThisDayIn(all));
  }, []);

  const clearEntries = useCallback(() => {
    // Locking mid-tear: the page is already gone from the server.
    if (tearTimer.current) clearTimeout(tearTimer.current);
    tearTimer.current = null;
    setTearing(null);
    setEntries([]);
  }, []);

  const saveEntry = async (text: string, activity: string, moodUser: number | null): Promise<boolean> => {
    setSaving(true);
    try {
      const entry = await createEntry(text, activity, moodUser);
      const updated = [entry, ...entries];
      replaceEntries(updated);
      play("save");
      // The entry is on the page now, so the writing view steps back — and
      // the local copy of the draft has done its job.
      clearDraft();
      setWriting(false);
      return true;
    } catch (e) {
      showNotice(`Couldn't save this page — your words are still here. ${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Stepping away discards the page, as it always has — so the local copy goes too. */
  const leaveWriting = () => {
    clearDraft();
    setWriting(false);
  };

  const updateEntryMood = useCallback((id: string, moodData: EntryMood) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...moodData } : e))
    );
  }, []);

  const toggleFavorite = useCallback((id: string, isFavorite: boolean) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, is_favorite: isFavorite } : e)));
  }, []);

  // Delete flows through an in-app confirmation dialog (entryToDelete state)
  const requestDelete = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) setEntryToDelete(entry);
  };

  const cancelDelete = useCallback(() => setEntryToDelete(null), []);

  /**
   * Tear the page out. Nothing is removed, and the rip is not drawn, until the
   * server has deleted it: a failed delete lets the entry settle back, so it
   * can never tear and then reappear. The list is updated by a timer rather
   * than by the animation ending, because the journal is drawn twice (one
   * copy is hidden) and may not be on screen at all.
   */
  const confirmDelete = async () => {
    if (!entryToDelete) return;
    const id = entryToDelete.id;
    setEntryToDelete(null);
    setTearing({ id, phase: "pending" });
    const [result] = await Promise.allSettled([
      deleteEntry(id),
      delay(prefersReducedMotion() ? 0 : TEAR_TREMBLE_MS),
    ]);
    if (result.status === "rejected") {
      setTearing(null);
      showNotice(`Couldn't tear out that page. ${(result.reason as Error).message}`);
      return;
    }
    setTearing({ id, phase: "ripping" });
    play("tear");
    haptic();
    tearTimer.current = setTimeout(() => {
      tearTimer.current = null;
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setOnThisDay((prev) => prev.filter((e) => e.id !== id));
      // A second page may have started tearing meanwhile; leave that one be.
      setTearing((t) => (t?.id === id ? null : t));
    }, tearDuration());
  };

  /** After a bulk import: fetch the list again. */
  const refreshAfterImport = async () => {
    try {
      const data = await getEntries();
      replaceEntries(data || []);
    } catch {
      // They are saved; only this page's copy of the list is behind.
      showNotice("Imported — but the journal couldn't refresh. Reload to see the new pages.");
    }
  };

  return {
    entries, onThisDay,
    writing, setWriting, leaveWriting,
    saving, saveEntry,
    highlightEntryId, flashEntry,
    entryToDelete, requestDelete, cancelDelete, confirmDelete, tearing,
    replaceEntries, clearEntries, updateEntryMood, toggleFavorite, refreshAfterImport,
  };
}

export type Journal = ReturnType<typeof useJournal>;
