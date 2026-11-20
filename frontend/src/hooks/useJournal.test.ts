import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";

// Only the network calls are faked; the storage helpers (used by draft.ts) stay real.
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  createEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getEntries: vi.fn(),
}));
vi.mock("../sounds", () => ({ play: vi.fn() }));

import { createEntry, deleteEntry, getEntries } from "../api";
import { hasDraft, saveDraft } from "../draft";
import { play } from "../sounds";
import { useJournal } from "./useJournal";

const entry = (id: string, created_at = "2026-03-02T10:00:00Z", text = `entry ${id}`): Entry => ({
  id, text, activity: null, mood: null, mood_label: null, mood_user: null, mood_user_label: null, created_at,
});

function setup(initial: Entry[] = []) {
  const showNotice = vi.fn();
  const hook = renderHook(() => useJournal(showNotice));
  if (initial.length) act(() => hook.result.current.replaceEntries(initial));
  return { ...hook, showNotice };
}

beforeEach(() => {
  vi.mocked(createEntry).mockReset();
  vi.mocked(deleteEntry).mockReset();
  vi.mocked(getEntries).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saving an entry", () => {
  it("puts it on top, plays the save sound, closes the writing view and clears the draft", async () => {
    vi.mocked(createEntry).mockResolvedValue(entry("new"));
    saveDraft("asha", "the words being saved");
    const { result } = setup([entry("old")]);
    act(() => result.current.setWriting(true));

    let ok = false;
    await act(async () => { ok = await result.current.saveEntry("the words", "Reflecting", 6); });

    expect(ok).toBe(true);
    expect(result.current.entries.map((e) => e.id)).toEqual(["new", "old"]);
    expect(play).toHaveBeenCalledWith("save");
    expect(result.current.writing).toBe(false);
    expect(result.current.saving).toBe(false);
    expect(hasDraft("asha")).toBe(false);
  });

  it("keeps the words, the writing view and the draft when the save fails", async () => {
    vi.mocked(createEntry).mockRejectedValue(new Error("offline"));
    saveDraft("asha", "do not lose me");
    const { result, showNotice } = setup([entry("old")]);
    act(() => result.current.setWriting(true));

    let ok = true;
    await act(async () => { ok = await result.current.saveEntry("do not lose me", "Reflecting", null); });

    expect(ok).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual(["old"]);
    expect(result.current.writing).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(hasDraft("asha")).toBe(true);
    expect(play).not.toHaveBeenCalledWith("save");
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining("your words are still here"));
  });
});

describe("tearing an entry out", () => {
  it("asks first, then removes it once the server has deleted it", async () => {
    vi.mocked(deleteEntry).mockResolvedValue({ success: true });
    const { result } = setup([entry("a"), entry("b")]);

    act(() => result.current.requestDelete("a"));
    expect(result.current.entryToDelete?.id).toBe("a");
    expect(deleteEntry).not.toHaveBeenCalled();

    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteEntry).toHaveBeenCalledWith("a");
    expect(result.current.entryToDelete).toBeNull();
    // Removed straight away, or once a tear-out animation has had its time.
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["b"]), { timeout: 3000 });
  });

  it("keeps the entry and says so when the delete fails", async () => {
    vi.mocked(deleteEntry).mockRejectedValue(new Error("Couldn't reach your archive"));
    const { result, showNotice } = setup([entry("a"), entry("b")]);

    act(() => result.current.requestDelete("a"));
    await act(async () => { await result.current.confirmDelete(); });

    expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining("Couldn't tear out that page"));
  });

  it("does nothing when cancelled", async () => {
    const { result } = setup([entry("a")]);
    act(() => result.current.requestDelete("a"));
    act(() => result.current.cancelDelete());
    await act(async () => { await result.current.confirmDelete(); });
    expect(deleteEntry).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(1);
  });

  it("ignores a request for an entry that isn't there", () => {
    const { result } = setup([entry("a")]);
    act(() => result.current.requestDelete("missing"));
    expect(result.current.entryToDelete).toBeNull();
  });
});

describe("on this day", () => {
  it("collects entries from today's date in earlier years only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 19, 12));
    const { result } = setup([
      entry("last-year", new Date(2025, 10, 19, 9).toISOString()),
      entry("today", new Date(2026, 10, 19, 9).toISOString()),
      entry("other-day", new Date(2025, 10, 18, 9).toISOString()),
    ]);
    expect(result.current.onThisDay.map((e) => e.id)).toEqual(["last-year"]);
  });
});

describe("highlighting an entry", () => {
  it("lasts four seconds, and a second highlight restarts the clock", () => {
    vi.useFakeTimers();
    const { result } = setup([entry("a"), entry("b")]);

    act(() => result.current.flashEntry("a"));
    expect(result.current.highlightEntryId).toBe("a");
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => result.current.flashEntry("b"));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.highlightEntryId).toBe("b");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.highlightEntryId).toBeNull();
  });
});

describe("after a bulk import", () => {
  it("reloads the list", async () => {
    vi.mocked(getEntries).mockResolvedValue([entry("x"), entry("y")]);
    const { result } = setup([entry("a")]);
    await act(async () => { await result.current.refreshAfterImport(); });
    expect(result.current.entries.map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("says the import is safe when only the refresh fails", async () => {
    vi.mocked(getEntries).mockRejectedValue(new Error("offline"));
    const { result, showNotice } = setup([entry("a")]);
    await act(async () => { await result.current.refreshAfterImport(); });
    expect(result.current.entries.map((e) => e.id)).toEqual(["a"]);
    expect(showNotice).toHaveBeenCalledWith(expect.stringContaining("Imported"));
  });
});
