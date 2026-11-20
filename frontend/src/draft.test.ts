import { describe, expect, it, vi } from "vitest";
import { clearDraft, hasDraft, loadDraft, saveDraft } from "./draft";

describe("the unsent draft", () => {
  it("hands the draft back to the person who wrote it", () => {
    saveDraft("asha", "half a thought");
    expect(loadDraft("asha")).toBe("half a thought");
    expect(hasDraft("asha")).toBe(true);
  });

  it("never hands one person's draft to someone else on the same device", () => {
    saveDraft("asha", "private words");
    expect(loadDraft("ravi")).toBe("");
    expect(hasDraft("ravi")).toBe(false);
  });

  it("has no draft for nobody", () => {
    saveDraft("", "orphan");
    expect(localStorage.getItem("arc_draft")).toBeNull();
    expect(loadDraft("")).toBe("");
  });

  it("removes the draft rather than storing an empty one", () => {
    saveDraft("asha", "something");
    saveDraft("asha", "   \n ");
    expect(localStorage.getItem("arc_draft")).toBeNull();
    expect(hasDraft("asha")).toBe(false);
  });

  it("is gone after clearDraft", () => {
    saveDraft("asha", "something");
    clearDraft();
    expect(loadDraft("asha")).toBe("");
  });

  it("treats an unreadable stored value as no draft", () => {
    localStorage.setItem("arc_draft", "{broken");
    expect(loadDraft("asha")).toBe("");
    localStorage.setItem("arc_draft", JSON.stringify({ owner: "asha", text: 42 }));
    expect(loadDraft("asha")).toBe("");
  });

  it("keeps writing working when storage throws", () => {
    const boom = () => { throw new Error("QuotaExceededError"); };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    expect(() => saveDraft("asha", "words")).not.toThrow();
    expect(loadDraft("asha")).toBe("");
  });
});
