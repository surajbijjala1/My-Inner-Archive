import { useState } from "react";
import { changePin } from "../api";

const NUMS: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

interface MiniPinPadProps {
  value: string;
  onChange: (value: string) => void;
  pinLength: number;
  disabled?: boolean;
}

function MiniPinPad({ value, onChange, pinLength, disabled }: MiniPinPadProps) {
  const press = (v: string) => {
    if (disabled) return;
    if (v === "⌫") { onChange(value.slice(0, -1)); return; }
    if (value.length >= pinLength) return;
    onChange(value + v);
  };

  return (
    <div>
      <div className="pin-dots" style={{ marginBottom: 12, justifyContent: "center" }}>
        {Array.from({ length: pinLength }).map((_, i) => (
          <div key={i} className={`pin-dot ${i < value.length ? "pin-dot--filled" : "pin-dot--empty"}`} />
        ))}
      </div>
      <div className="pin-numpad" style={{ transform: "scale(0.85)", transformOrigin: "center top" }}>
        {NUMS.map((n, i) => (
          <button
            key={i}
            className="pin-num-btn"
            style={{ visibility: n === "" ? "hidden" : "visible" }}
            onClick={() => press(n)}
            disabled={disabled}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

type ProfileStep = "menu" | "change-current" | "change-new" | "change-confirm" | "success";

interface ProfileModalProps {
  username: string;
  pinLength: number;
  onClose: () => void;
  onSignOut: () => void;
  /** OCR-based import is gated to owner + own-API-key users. */
  canUseOcr: boolean;
  onOpenBulkImport: () => void;
}

export default function ProfileModal({ username, pinLength: initialPinLength, onClose, onSignOut, canUseOcr, onOpenBulkImport }: ProfileModalProps) {
  const [step, setStep] = useState<ProfileStep>("menu");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [newPinLength, setNewPinLength] = useState<4 | 6>(initialPinLength === 6 ? 6 : 4);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const pinLength = initialPinLength || 4;

  // Auto-advance through steps
  const handleCurrentPin = (p: string) => {
    setCurrentPin(p);
    if (p.length === pinLength) setTimeout(() => setStep("change-new"), 200);
  };
  const handleNewPin = (p: string) => {
    setNewPin(p);
    if (p.length === newPinLength) setTimeout(() => setStep("change-confirm"), 200);
  };
  const handleConfirmPin = async (p: string) => {
    setConfirmPin(p);
    if (p.length === newPinLength) {
      if (p !== newPin) {
        setError("PINs don't match. Try again.");
        setNewPin("");
        setConfirmPin("");
        setStep("change-new");
        return;
      }
      setSaving(true);
      setError("");
      try {
        await changePin(currentPin, newPin);
        setStep("success");
      } catch (e) {
        setError((e as Error).message || "Failed to change PIN");
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
        setStep("change-current");
      }
      setSaving(false);
    }
  };

  const reset = () => {
    setStep("menu");
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setError("");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div className="modal-title" style={{ margin: 0 }}>
            {step === "menu" ? "👤 Profile" : "🔑 Change PIN"}
          </div>
          <button
            onClick={step === "menu" ? onClose : reset}
            style={{
              background: "none", border: "none", fontSize: "18px",
              cursor: "pointer", color: "var(--text-tertiary)",
            }}
          >
            {step === "menu" ? "✕" : "←"}
          </button>
        </div>

        {step === "menu" && (
          <div>
            {/* Username row */}
            <div style={{
              background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)",
              padding: "12px 14px", marginBottom: 16,
            }}>
              <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginBottom: 3 }}>Username (permanent)</div>
              <div style={{ fontWeight: 600, fontSize: "15px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                🌱 {username}
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>🔒</span>
              </div>
            </div>

            {/* PIN info */}
            <div style={{
              background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)",
              padding: "12px 14px", marginBottom: 16,
            }}>
              <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginBottom: 3 }}>Current PIN</div>
              <div style={{ fontSize: "13.5px", color: "var(--text-secondary)" }}>
                {"•".repeat(pinLength)}&ensp;({pinLength}-digit)
              </div>
            </div>

            <button
              className="modal-close-btn"
              style={{ width: "100%" }}
              onClick={() => setStep("change-current")}
            >
              Change PIN
            </button>

            <button
              className="modal-close-btn"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => {
                if (!canUseOcr) {
                  alert(
                    "Importing photographed pages uses AI vision, which isn't included in " +
                    "the free trial.\n\nAdd your own free Google Gemini API key to unlock it."
                  );
                  return;
                }
                onOpenBulkImport();
              }}
            >
              📚 Import Physical Journal
            </button>

            <button
              className="signout-btn"
              style={{ width: "100%", marginTop: 12 }}
              onClick={onSignOut}
            >
              🚪 Sign Out
            </button>
          </div>
        )}

        {step === "change-current" && (
          <div>
            <div style={{ fontSize: "13.5px", color: "var(--text-secondary)", textAlign: "center", marginBottom: 16 }}>
              Enter your <strong>current</strong> {pinLength}-digit PIN to verify
            </div>
            {error && <div style={{ color: "var(--color-error)", fontSize: "12.5px", textAlign: "center", marginBottom: 12 }}>{error}</div>}
            <MiniPinPad value={currentPin} onChange={handleCurrentPin} pinLength={pinLength} disabled={saving} />
          </div>
        )}

        {step === "change-new" && (
          <div>
            <div style={{ fontSize: "13.5px", color: "var(--text-secondary)", textAlign: "center", marginBottom: 12 }}>
              Choose your <strong>new</strong> PIN
            </div>
            <div className="pin-length-toggle" style={{ marginBottom: 16 }}>
              <button
                className={`pin-length-btn ${newPinLength === 4 ? "pin-length-btn--active" : ""}`}
                onClick={() => { setNewPinLength(4); setNewPin(""); }}
              >4-digit</button>
              <button
                className={`pin-length-btn ${newPinLength === 6 ? "pin-length-btn--active" : ""}`}
                onClick={() => { setNewPinLength(6); setNewPin(""); }}
              >6-digit</button>
            </div>
            <MiniPinPad value={newPin} onChange={handleNewPin} pinLength={newPinLength} disabled={saving} />
          </div>
        )}

        {step === "change-confirm" && (
          <div>
            <div style={{ fontSize: "13.5px", color: "var(--text-secondary)", textAlign: "center", marginBottom: 16 }}>
              Confirm your <strong>new</strong> {newPinLength}-digit PIN
            </div>
            {error && <div style={{ color: "var(--color-error)", fontSize: "12.5px", textAlign: "center", marginBottom: 12 }}>{error}</div>}
            <MiniPinPad value={confirmPin} onChange={handleConfirmPin} pinLength={newPinLength} disabled={saving} />
            {saving && <div className="loading-pulse" style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", marginTop: 12 }}>Saving...</div>}
          </div>
        )}

        {step === "success" && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: 8 }}>PIN updated!</div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: 20 }}>
              Your new {newPinLength}-digit PIN is active.
            </div>
            <button className="modal-close-btn" style={{ width: "100%" }} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
