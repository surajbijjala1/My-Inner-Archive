/**
 * In-app confirmation dialog — replaces native window.confirm(), which renders
 * as an ugly system popup ("localhost says...") especially inside the Android
 * WebView. Paper-styled: prose body, quoted excerpt, handwritten actions.
 */

interface ConfirmDialogProps {
  title: string;
  /** Main question / consequence line. */
  message: string;
  /** Optional preview of the thing being acted on (e.g. entry excerpt). */
  excerpt?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  excerpt,
  confirmLabel = "confirm",
  cancelLabel = "keep it",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-content"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 360 }}
      >
        <div className="modal-title" id="confirm-title">{title}</div>
        <p className="sheet-text">{message}</p>

        {excerpt && (
          <blockquote className="sheet-quote">
            {excerpt.length > 140 ? excerpt.slice(0, 137) + "…" : excerpt}
          </blockquote>
        )}

        <div className="sheet-actions">
          <button className="sheet-btn" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
          <button
            className={`sheet-btn ${danger ? "sheet-btn--danger" : "sheet-btn--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
