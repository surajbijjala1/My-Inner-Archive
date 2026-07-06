import { useRef, useState } from "react";
import { ocrImage } from "../api";
import { prepareImage } from "../imageUtils";

interface CameraCaptureProps {
  /** Owner or own-API-key users only (pre-approved decision #12). */
  canUseOcr: boolean;
  /** Called with extracted text ready to drop into the entry field. */
  onText: (text: string) => void;
}

/**
 * Camera icon on the entry form (Feature 7): photo → OCR → entry text.
 * Web: file input with capture hint. Native camera plugin arrives in Phase 3
 * behind the same component.
 */
export default function CameraCapture({ canUseOcr, onText }: CameraCaptureProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleClick = () => {
    if (busy) return;
    if (!canUseOcr) {
      alert(
        "Photo import uses AI vision, which isn't included in the free trial.\n\n" +
        "Add your own free Google Gemini API key (chat panel → key prompt) to unlock it."
      );
      return;
    }
    inputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setStatus("Preparing photo...");
    try {
      const prepared = await prepareImage(file);

      if (prepared.quality.dark || prepared.quality.blurry) {
        const problems = [
          prepared.quality.dark ? "dark" : null,
          prepared.quality.blurry ? "blurry" : null,
        ].filter(Boolean).join(" and ");
        const proceed = confirm(
          `This photo looks ${problems} — text extraction may miss parts.\n\n` +
          `OK to process anyway, or Cancel to retake with better lighting.`
        );
        if (!proceed) { setBusy(false); setStatus(null); return; }
      }

      setStatus("Extracting text...");
      const result = await ocrImage(prepared.base64, prepared.mimeType);

      if (result.warning === "no_text" || !result.text) {
        alert("No text found in image — try again with better lighting.");
      } else {
        onText(result.text);
        if (result.warning === "partial") {
          alert("Some text may be missing — please review and edit before saving.");
        }
      }
    } catch (e) {
      alert((e as Error).message || "Text extraction failed. Please try again.");
    }
    setBusy(false);
    setStatus(null);
  };

  return (
    <>
      <button
        className="entry-tool-btn"
        onClick={handleClick}
        disabled={busy}
        title={canUseOcr ? "Photograph a page to import its text" : "Requires your own API key"}
      >
        {busy ? "⏳" : "📷"}
        {status && <span className="entry-tool-status">{status}</span>}
      </button>
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
}
