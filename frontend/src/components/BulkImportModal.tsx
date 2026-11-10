import { useRef, useState } from "react";
import { ocrImage, segmentText, createEntriesBatch } from "../api";
import { prepareImage } from "../imageUtils";

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
  /** In-sheet message: tied to one draft (index) or to the whole import. */
  const [notice, setNotice] = useState<{ index?: number; text: string } | null>(null);
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
    // Checked outside the state updater: updaters must stay pure (React may
    // run them twice), and this one used to raise a browser alert.
    const parts = drafts[i].text.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      setNotice({ index: i, text: "put --- on a line of its own where it should divide, then split" });
      return;
    }
    setNotice(null);
    setDrafts((prev) => {
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
      setNotice({ text: `couldn't save them — ${(e as Error).message}` });
    }
    setSaving(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const pageWord = (n: number) => `${n} page${n === 1 ? "" : "s"}`;
  const pageState: Record<PageStatus["state"], string> = {
    pending: "waiting",
    ocr: "reading the page…",
    segment: "finding the entries…",
    ok: "done",
    failed: "couldn't read it",
  };

  return (
    <div className="modal-overlay" onClick={phase === "processing" ? undefined : onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 540 }}
      >
        <div className="sheet-head">
          <div className="modal-title" id="import-title">Bring in a paper journal</div>
          {phase !== "processing" && (
            <button className="sheet-back" onClick={onClose}>
              {phase === "done" ? "done" : "back"}
            </button>
          )}
        </div>

        {phase === "select" && (
          <>
            <p className="sheet-text">
              Photograph your journal pages — up to {MAX_PAGES} at a time. Each page is read and
              split into entries you can check over before anything is saved.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const chosen = Array.from(e.target.files || []);
                e.target.value = "";
                setFiles((prev) => [...prev, ...chosen].slice(0, MAX_PAGES));
              }}
            />
            {files.length > 0 && (
              <>
                <ul className="sheet-list">
                  {files.map((f, i) => (
                    <li key={i} className="sheet-row">
                      <span className="sheet-row-title" style={{ flex: 1, minWidth: 0 }}>{f.name}</span>
                      <button
                        className="sheet-row-x"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label={`Remove ${f.name}`}
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="sheet-note" style={{ marginTop: "var(--space-sm)" }}>
                  about {Math.ceil((files.length * SECONDS_PER_PAGE) / 60)} min — it's paced to
                  stay inside the AI's free limits
                </p>
              </>
            )}
            <div className="sheet-actions">
              <button
                className={`sheet-btn ${files.length ? "" : "sheet-btn--primary"}`}
                onClick={() => inputRef.current?.click()}
                disabled={files.length >= MAX_PAGES}
              >
                {files.length ? "add more pages" : "choose page photos"}
              </button>
              {files.length > 0 && (
                <button className="sheet-btn sheet-btn--primary" onClick={startProcessing}>
                  read {pageWord(files.length)}
                </button>
              )}
            </div>
          </>
        )}

        {phase === "processing" && (
          <>
            <p className="sheet-text" aria-live="polite">
              Reading {progress.done} of {pageWord(progress.total)} · {etaLabel}
            </p>
            <div
              className="sheet-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <ul className="sheet-list">
              {pages.map((p, i) => (
                <li key={i} className="sheet-row">
                  <span className="sheet-row-title" style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                  <span className={`sheet-row-meta ${p.state === "failed" ? "sheet-row-meta--error" : ""}`}>
                    {pageState[p.state]}
                    {p.error ? ` — ${p.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="sheet-actions">
              <button className="sheet-btn" onClick={() => { cancelRef.current = true; }}>
                stop after this page
              </button>
            </div>
          </>
        )}

        {phase === "review" && (
          <>
            <p className="sheet-text">
              {drafts.length === 0
                ? "Nothing could be read from those pages. Try clearer, well-lit photos."
                : `${drafts.length} entr${drafts.length === 1 ? "y" : "ies"} found. Check them over — to split one, put --- on a line of its own, then choose split.`}
            </p>
            {drafts.map((d, i) => (
              <div key={i} className="import-draft">
                <textarea
                  className="sheet-area"
                  aria-label={`Entry ${i + 1} text`}
                  value={d.text}
                  onChange={(e) => updateDraft(i, { text: e.target.value })}
                />
                <div className="import-fields">
                  <label className="import-field">
                    <span>tag</span>
                    <input
                      className="sheet-field"
                      value={d.tag}
                      maxLength={30}
                      onChange={(e) => updateDraft(i, { tag: e.target.value })}
                    />
                  </label>
                  <label className="import-field import-field--narrow">
                    <span>mood</span>
                    <input
                      className="sheet-field"
                      type="number"
                      min={1}
                      max={10}
                      value={d.mood}
                      onChange={(e) =>
                        updateDraft(i, { mood: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 5)) })
                      }
                    />
                  </label>
                  <label className="import-field">
                    <span>date</span>
                    <input
                      className="sheet-field"
                      type="date"
                      value={d.date ?? ""}
                      onChange={(e) => updateDraft(i, { date: e.target.value || null })}
                      title="Blank means today"
                    />
                  </label>
                </div>
                {notice?.index === i && <p className="sheet-error" role="status">{notice.text}</p>}
                <div className="import-draft-actions">
                  <button className="sheet-row-x" onClick={() => splitDraft(i)}>split</button>
                  {i > 0 && (
                    <button className="sheet-row-x" onClick={() => mergeWithAbove(i)}>join with the one above</button>
                  )}
                  <button className="sheet-row-x" onClick={() => deleteDraft(i)}>leave out</button>
                </div>
              </div>
            ))}
            {notice && notice.index === undefined && (
              <p className="sheet-error" role="alert">{notice.text}</p>
            )}
            {drafts.length > 0 && (
              <div className="sheet-actions">
                <button className="sheet-btn sheet-btn--primary" onClick={approveAll} disabled={saving}>
                  {saving ? "saving…" : `keep all ${drafts.length}`}
                </button>
              </div>
            )}
          </>
        )}

        {phase === "done" && (
          <p className="sheet-text">
            {insertedCount} entr{insertedCount === 1 ? "y is" : "ies are"} in your archive now,
            dated as written. They'll become searchable for your companion in the background.
          </p>
        )}
      </div>
    </div>
  );
}
