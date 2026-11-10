import { useRef, useState, useImperativeHandle, forwardRef } from "react";
import { ocrImage } from "../api";
import { prepareImage } from "../imageUtils";
import ConfirmDialog from "./ConfirmDialog";

type Prepared = Awaited<ReturnType<typeof prepareImage>>;

/** A line in the writing view's margin; errors are inked red and announced. */
interface Note {
  text: string;
  error?: boolean;
}

export interface CameraCaptureHandle {
  /** Opened from the page's bottom action bar. */
  open: () => void;
}

interface CameraCaptureProps {
  /** Owner or own-API-key users only (pre-approved decision #12). */
  canUseOcr: boolean;
  /** Called with extracted text ready to drop into the entry field. */
  onText: (text: string) => void;
}

/**
 * Photo → OCR → entry text (Feature 7). The paper design has no camera
 * button on the page itself; the action bar opens this, so the component
 * renders only its hidden input and whatever it is currently doing.
 */
const CameraCapture = forwardRef<CameraCaptureHandle, CameraCaptureProps>(
  function CameraCapture({ canUseOcr, onText }, ref) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Outcome of the last attempt — stays until the next one, so it can be read.
  const [note, setNote] = useState<Note | null>(null);
  // A dark or blurry photo waiting on "process anyway?" (was a native confirm()).
  const [doubtful, setDoubtful] = useState<{ prepared: Prepared; problems: string } | null>(null);

  const handleClick = () => {
    if (busy) return;
    if (!canUseOcr) {
      setNote({
        text: "Photo import uses AI vision, which isn't in the free trial — add your own free Gemini API key (chat panel → key prompt) to unlock it.",
        error: true,
      });
      return;
    }
    setNote(null);
    inputRef.current?.click();
  };

  useImperativeHandle(ref, () => ({ open: handleClick }));

  const finish = () => {
    setBusy(false);
    setStatus(null);
  };

  const extract = async (prepared: Prepared) => {
    setBusy(true);
    setStatus("reading it\u2026");
    try {
      const result = await ocrImage(prepared.base64, prepared.mimeType);
      if (result.warning === "no_text" || !result.text) {
        setNote({ text: "No text found in that photo — try again with better lighting.", error: true });
      } else {
        onText(result.text);
        if (result.warning === "partial") {
          setNote({ text: "Some text may be missing — read it over before you save." });
        }
      }
    } catch (e) {
      setNote({ text: (e as Error).message || "Couldn't read that photo. Please try again.", error: true });
    }
    finish();
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setNote(null);
    setStatus("looking at the photo\u2026");
    let prepared: Prepared;
    try {
      prepared = await prepareImage(file);
    } catch (e) {
      setNote({ text: (e as Error).message || "Couldn't open that photo. Please try another.", error: true });
      finish();
      return;
    }

    if (prepared.quality.dark || prepared.quality.blurry) {
      const problems = [
        prepared.quality.dark ? "dark" : null,
        prepared.quality.blurry ? "blurry" : null,
      ].filter(Boolean).join(" and ");
      setStatus(null);
      setDoubtful({ prepared, problems }); // busy stays on until they choose
      return;
    }
    await extract(prepared);
  };

  return (
    <>
      {status ? (
        <div className="writing-aside" role="status">{status}</div>
      ) : note ? (
        <div
          className={`writing-aside${note.error ? " writing-aside--error" : ""}`}
          role={note.error ? "alert" : "status"}
        >
          {note.text}
        </div>
      ) : null}
      {doubtful && (
        <ConfirmDialog
          title="This photo looks hard to read"
          message={`It looks ${doubtful.problems}, so some of the writing may be missed. Retake it with better light, or read it as it is?`}
          confirmLabel="read it anyway"
          cancelLabel="retake"
          onConfirm={() => {
            const { prepared } = doubtful;
            setDoubtful(null);
            void extract(prepared);
          }}
          onCancel={() => {
            setDoubtful(null);
            finish();
          }}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file
          if (file) handleFile(file);
        }}
      />
    </>
  );
});

export default CameraCapture;
