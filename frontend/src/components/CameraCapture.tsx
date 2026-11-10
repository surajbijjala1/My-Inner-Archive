import { useRef, useState, useImperativeHandle, forwardRef } from "react";
import { ocrImage } from "../api";
import { prepareImage } from "../imageUtils";

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

  useImperativeHandle(ref, () => ({ open: handleClick }));

  const handleFile = async (file: File) => {
    setBusy(true);
    setStatus("looking at the photo\u2026");
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

      setStatus("reading it\u2026");
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
      {status && <div className="writing-aside">{status}</div>}
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
