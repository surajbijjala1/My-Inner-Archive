/**
 * In-app confirmation dialog — replaces native window.confirm(), which renders
 * as an ugly system popup ("localhost says...") especially inside the Android
 * WebView. Uses the existing modal design system.
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
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel} style={{ zIndex: 1000 }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 340 }}
      >
        <div className="modal-title" style={{ marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: "13.5px", color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: excerpt ? 10 : 18 }}>
          {message}
        </div>

        {excerpt && (
          <div
            style={{
              fontSize: "12.5px",
              color: "var(--text-tertiary)",
              background: "var(--bg-tertiary)",
              borderRadius: "var(--radius-md)",
              padding: "10px 12px",
              marginBottom: 18,
              maxHeight: 88,
              overflow: "hidden",
              lineHeight: 1.5,
            }}
          >
            {excerpt.length > 140 ? excerpt.slice(0, 137) + "…" : excerpt}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="modal-close-btn"
            style={{ flex: 1, marginTop: 0 }}
            onClick={onCancel}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            className={`confirm-btn ${danger ? "confirm-btn--danger" : ""}`}
            style={{ flex: 1 }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
