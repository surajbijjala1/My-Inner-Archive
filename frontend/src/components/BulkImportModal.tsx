import { useRef, useState } from "react";
import { ocrImage, segmentText, createEntriesBatch } from "../api";
import { prepareImage } from "../imageUtils";
import { moodColor } from "../utils";

/**
 * BulkImportModal (Feature 8) — one-time migration of physical journal pages.
 * Flow: select up to 20 photos → sequential OCR + segmentation (rate-limited
 * for the Gemini free tier) → review screen (edit / split / merge / delete) →
 * batch insert.
 *
 * Split convention: insert a line containing only --- where an entry should
 * split, then press its Split button.
 */

const MAX_PAGES = 20;
// Two Gemini calls per page (OCR + segmentation) at ~4.5s spacing ≈ 15 RPM free tier
const CALL_SPACING_MS = 4500;
const SECONDS_PER_PAGE = 10;

type Phase = "select" | "processing" | "review" | "done";

interface DraftEntry {
  text: string;
  tag: string;
  mood: number;
  date: string | null;
}

interface PageStatus {
  name: string;
  state: "pending" | "ocr" | "segment" | "ok" | "failed";
  error?: string;
}

interface BulkImportModalProps {
  onClose: () => void;
  /** Called after a successful import so the app can refresh the entry list. */
  onImported: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function BulkImportModal({ onClose, onImported }: BulkImportModalProps) {
  const [phase, setPhase] = useState<Phase>("select");
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<PageStatus[]>([]);
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [insertedCount, setInsertedCount] = useState(0);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const etaSeconds = (progress.total - progress.done) * SECONDS_PER_PAGE;
  const etaLabel = etaSeconds >= 60
    ? `~${Math.ceil(etaSeconds / 60)} min remaining`
    : `~${etaSeconds}s remaining`;

  // ── Processing pipeline ────────────────────────────────────────────────────

  const startProcessing = async () => {
    if (files.length === 0) return;
    cancelRef.current = false;
    setPhase("processing");
    setProgress({ done: 0, total: files.length });
    const statuses: PageStatus[] = files.map((f) => ({ name: f.name, state: "pending" }));
    setPages([...statuses]);
    const collected: DraftEntry[] = [];

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;
      const update = (state: PageStatus["state"], error?: string) => {
        statuses[i] = { ...statuses[i], state, error };
        setPages([...statuses]);
      };

      try {
        update("ocr");
        const prepared = await prepareImage(files[i]);
        const ocr = await ocrImage(prepared.base64, prepared.mimeType);
        if (!ocr.text || ocr.warning === "no_text") {
          update("failed", "No text found");
        } else {
          await sleep(CALL_SPACING_MS);
          update("segment");
          const { entries } = await segmentText(ocr.text);
          collected.push(...entries.map((e) => ({
            text: e.text,
            tag: e.tag,
            mood: e.mood,
            date: e.date,
          })));
          update("ok");
        }
      } catch (e) {
        update("failed", (e as Error).message);
      }

      setProgress({ done: i + 1, total: files.length });
      if (i < files.length - 1) await sleep(CALL_SPACING_MS);
    }

    setDrafts(collected);
    setPhase("review");
  };

  // ── Review-screen operations ───────────────────────────────────────────────

  const updateDraft = (i: number, patch: Partial<DraftEntry>) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  const deleteDraft = (i: number) => {
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const mergeWithAbove = (i: number) => {
    if (i === 0) return;
    setDrafts((prev) => {
      const merged = [...prev];
      merged[i - 1] = { ...merged[i - 1], text: `${merged[i - 1].text}\n\n${merged[i].text}` };
      merged.splice(i, 1);
      return merged;
    });
  };

  const splitDraft = (i: number) => {
    setDrafts((prev) => {
      const parts = prev[i].text.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) {
        alert("To split: put a line containing only --- where the entry should divide, then press Split.");
        return prev;
      }
      const next = [...prev];
      next.splice(i, 1, ...parts.map((text) => ({ ...prev[i], text })));
      return next;
    });
  };

  const approveAll = async () => {
    if (drafts.length === 0) return;
    setSaving(true);
    try {
      const result = await createEntriesBatch(
        drafts.map((d) => ({ text: d.text, activity: `🏷 ${d.tag}`, mood: d.mood, date: d.date }))
      );
      setInsertedCount(result.inserted);
      setPhase("done");
      onImported();
    } catch (e) {
      alert("Import failed: " + (e as Error).message);
    }
    setSaving(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={phase === "processing" ? undefined : onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="modal-title" style={{ margin: 0 }}>📚 Import Physical Journal</div>
          {phase !== "processing" && (
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "var(--text-tertiary)" }}
            >
              ✕
            </button>
          )}
        </div>

        {phase === "select" && (
          <div>
            <div className="modal-subtitle">
              Photograph journal pages (up to {MAX_PAGES} at a time). Each page is OCR'd and
              split into entries you can review before anything is saved.
            </div>
            <button className="modal-close-btn" style={{ width: "100%" }} onClick={() => inputRef.current?.click()}>
              {files.length > 0 ? `${files.length} page${files.length === 1 ? "" : "s"} selected — add more` : "Select page photos"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const chosen = Array.from(e.target.files || []);
                e.target.value = "";
                setFiles((prev) => [...prev, ...chosen].slice(0, MAX_PAGES));
              }}
            />
            {files.length > 0 && (
              <>
                <div style={{ margin: "12px 0", fontSize: "12.5px", color: "var(--text-tertiary)" }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 10 }}>
                  Estimated time: ~{Math.ceil((files.length * SECONDS_PER_PAGE) / 60)} min
                  (AI rate limits require pacing)
                </div>
                <button className="save-btn" style={{ width: "100%" }} onClick={startProcessing}>
                  Extract {files.length} page{files.length === 1 ? "" : "s"}
                </button>
              </>
            )}
          </div>
        )}

        {phase === "processing" && (
          <div>
            <div className="modal-subtitle">
              Extracting… {progress.done}/{progress.total} pages · {etaLabel}
            </div>
            <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, height: 10, overflow: "hidden", marginBottom: 14 }}>
              <div
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  height: "100%",
                  background: "var(--text-primary)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <div style={{ fontSize: "12.5px", color: "var(--text-tertiary)", maxHeight: 200, overflowY: "auto" }}>
              {pages.map((p, i) => (
                <div key={i} style={{ padding: "3px 0" }}>
                  {p.state === "ok" ? "✅" : p.state === "failed" ? "❌" : p.state === "pending" ? "⬜" : "⏳"}{" "}
                  {p.name}
                  {p.state === "ocr" && " — reading text..."}
                  {p.state === "segment" && " — splitting into entries..."}
                  {p.error && <span style={{ color: "var(--color-error)" }}> — {p.error}</span>}
                </div>
              ))}
            </div>
            <button
              className="modal-close-btn"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => { cancelRef.current = true; }}
            >
              Stop after current page
            </button>
          </div>
        )}

        {phase === "review" && (
          <>
            <div className="modal-subtitle">
              {drafts.length} entr{drafts.length === 1 ? "y" : "ies"} extracted — review and edit
              before saving. To split one, put <code>---</code> on its own line, then press Split.
            </div>
            <div style={{ flex: 1, overflowY: "auto", margin: "8px 0" }}>
              {drafts.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: "13px" }}>
                  Nothing extracted. Go back and try clearer photos.
                </div>
              )}
              {drafts.map((d, i) => (
                <div key={i} className="entry-card" style={{ marginBottom: 10 }}>
                  <textarea
                    className="entry-textarea"
                    style={{ minHeight: 90, marginBottom: 8 }}
                    value={d.text}
                    onChange={(e) => updateDraft(i, { text: e.target.value })}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                    <input
                      className="add-tag-input"
                      style={{ width: 120 }}
                      value={d.tag}
                      maxLength={30}
                      onChange={(e) => updateDraft(i, { tag: e.target.value })}
                      title="Tag"
                    />
                    <label style={{ fontSize: "12px", color: moodColor(d.mood), display: "flex", alignItems: "center", gap: 4 }}>
                      Mood
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={d.mood}
                        style={{ width: 48, padding: "4px 6px", border: "1.5px solid var(--border-input)", borderRadius: 6, fontFamily: "inherit" }}
                        onChange={(e) => updateDraft(i, { mood: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 5)) })}
                      />
                    </label>
                    <input
                      type="date"
                      value={d.date ?? ""}
                      style={{ padding: "4px 6px", border: "1.5px solid var(--border-input)", borderRadius: 6, fontFamily: "inherit", fontSize: "12px" }}
                      onChange={(e) => updateDraft(i, { date: e.target.value || null })}
                      title="Entry date (blank = today)"
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="activity-chip" onClick={() => splitDraft(i)}>✂️ Split</button>
                    {i > 0 && <button className="activity-chip" onClick={() => mergeWithAbove(i)}>🔗 Merge with above</button>}
                    <button className="activity-chip" style={{ color: "var(--color-error)" }} onClick={() => deleteDraft(i)}>🗑 Delete</button>
                  </div>
                </div>
              ))}
            </div>
            {drafts.length > 0 && (
              <button className="save-btn" style={{ width: "100%" }} onClick={approveAll} disabled={saving}>
                {saving ? "Saving..." : `Approve & save all ${drafts.length}`}
              </button>
            )}
          </>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: 8 }}>
              {insertedCount} entr{insertedCount === 1 ? "y" : "ies"} imported!
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: 20 }}>
              They're in your archive now, dated as written. Search indexing happens in the background.
            </div>
            <button className="modal-close-btn" style={{ width: "100%" }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
