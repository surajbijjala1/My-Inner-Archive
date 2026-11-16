import { useCallback, useState } from "react";
import { createEntry, deleteEntry, getEntries } from "../api";
import { clearDraft } from "../draft";
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

  /** Replace the list and recompute "on this day" from it. */
  const replaceEntries = useCallback((all: Entry[]) => {
    setEntries(all);
    setOnThisDay(onThisDayIn(all));
  }, []);

  const clearEntries = useCallback(() => setEntries([]), []);

  const saveEntry = async (text: string, activity: string, moodUser: number | null): Promise<boolean> => {
    setSaving(true);
    try {
      const entry = await createEntry(text, activity, moodUser);
      const updated = [entry, ...entries];
      replaceEntries(updated);
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

  const confirmDelete = async () => {
    if (!entryToDelete) return;
    const id = entryToDelete.id;
    setEntryToDelete(null);
    try {
      await deleteEntry(id);
      replaceEntries(entries.filter((e) => e.id !== id));
    } catch (e) {
      showNotice(`Couldn't tear out that page. ${(e as Error).message}`);
    }
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
    highlightEntryId, setHighlightEntryId,
    entryToDelete, requestDelete, cancelDelete, confirmDelete,
    replaceEntries, clearEntries, updateEntryMood, toggleFavorite, refreshAfterImport,
  };
}

export type Journal = ReturnType<typeof useJournal>;
