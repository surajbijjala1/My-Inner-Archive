import { useEffect, useState } from "react";
import { changePin, getNotificationSettings, saveNotificationSettings, setPersona, saveInstructions } from "../api";
import { isNativeApp } from "../native";
import type { PersonaMeta } from "../types";

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

type ProfileStep = "menu" | "change-current" | "change-new" | "change-confirm" | "success" | "notifications" | "companion";

interface CompanionPanelProps {
  personas: PersonaMeta[];
  personaId: string;
  onPersonaChange: (id: string) => void;
  customInstructions: string;
  onInstructionsChange: (text: string) => void;
  /** True while the current chat has messages — switching is only offered on a fresh chat. */
  personaLocked: boolean;
}

function CompanionPanel({ personas, personaId, onPersonaChange, customInstructions, onInstructionsChange, personaLocked }: CompanionPanelProps) {
  const [instructions, setInstructions] = useState(customInstructions);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectPersona = async (id: string) => {
    if (id === personaId || switching || personaLocked) return;
    setSwitching(id);
    setMessage(null);
    try {
      await setPersona(id);
      onPersonaChange(id);
    } catch (e) {
      setMessage((e as Error).message || "Failed to switch persona");
    }
    setSwitching(null);
  };

  const saveText = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveInstructions(instructions.trim());
      onInstructionsChange(instructions.trim());
      setMessage("Saved ✓");
    } catch (e) {
      setMessage((e as Error).message || "Failed to save");
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.6 }}>
        Choose who you talk to. Every companion knows your journal and follows the same
        safety principles — they differ in how they show up for you.
      </div>

      {personaLocked && (
        <div style={{
          fontSize: "12.5px", color: "var(--text-tertiary)", background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 14, lineHeight: 1.5,
        }}>
          You're mid-conversation, so switching is paused for now — start a new chat to pick
          a different companion.
        </div>
      )}

      {personas.length === 0 && (
        <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: 12, textAlign: "center" }}>
          Couldn't load companions — check your connection and reopen this panel.
        </div>
      )}

      {personas.map((p) => {
        const selected = p.id === personaId;
        return (
          <button
            key={p.id}
            className={`persona-card ${selected ? "persona-card--selected" : ""}`}
            onClick={() => selectPersona(p.id)}
            disabled={!!switching || personaLocked}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: "15px" }}>{p.emoji}</span>
              <span style={{ fontWeight: 700, fontSize: "14px" }}>{p.name}</span>
              <span style={{ fontSize: "11.5px", color: "var(--text-muted)" }}>· {p.meaning}</span>
              {selected && <span style={{ marginLeft: "auto", fontSize: "12px", color: "#4a8" }}>✓ active</span>}
              {switching === p.id && <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-muted)" }}>…</span>}
            </div>
            <div style={{ fontSize: "12.5px", color: "var(--text-tertiary)", lineHeight: 1.5, textAlign: "left" }}>
              {p.description}
            </div>
          </button>
        );
      })}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: 6 }}>How should they talk to you?</div>
        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
          Optional. Your own words, always included — e.g. "keep replies short", "don't ask
          more than one question", "I respond well to metaphors."
        </div>
        <textarea
          className="entry-textarea"
          style={{ minHeight: 70 }}
          maxLength={500}
          placeholder="Write your preferences..."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "right", marginBottom: 8 }}>
          {instructions.length}/500
        </div>
        {message && (
          <div style={{ fontSize: "12.5px", marginBottom: 8, color: message === "Saved ✓" ? "#4a8" : "var(--color-error)" }}>
            {message}
          </div>
        )}
        <button className="save-btn" style={{ width: "100%" }} onClick={saveText} disabled={saving}>
          {saving ? "Saving..." : "Save preferences"}
        </button>
      </div>
    </div>
  );
}

function NotificationSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [times, setTimes] = useState<string[]>(["08:00", "18:00"]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getNotificationSettings()
      .then((s) => {
        setEnabled(s.enabled);
        setTimes(s.times.length > 0 ? s.times : ["08:00", "18:00"]);
      })
      .catch(() => setMessage("Could not load settings"))
      .finally(() => setLoading(false));
  }, []);

  const applyPreset = (preset: "once" | "twice") => {
    setTimes(preset === "once" ? ["08:00"] : ["08:00", "18:00"]);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveNotificationSettings({
        enabled,
        times,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setMessage("Saved ✓");
    } catch (e) {
      setMessage((e as Error).message || "Failed to save");
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="loading-pulse" style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", padding: 16 }}>Loading...</div>;
  }

  return (
    <div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.6 }}>
        Daily notifications resurface an uplifting moment from your own archive — high-mood
        entries and anything you've starred ★.
        {!isNativeApp() && (
          <div style={{ marginTop: 6, fontSize: "12px", color: "var(--text-muted)" }}>
            Delivered to the Android app. Set your preferences here; they apply once the app
            is installed on your phone.
          </div>
        )}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, cursor: "pointer", fontSize: "14px", fontWeight: 600 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable daily notifications
      </label>

      {enabled && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button className="activity-chip" onClick={() => applyPreset("once")}>Once daily</button>
            <button className="activity-chip" onClick={() => applyPreset("twice")}>Twice daily</button>
          </div>
          {times.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <input
                type="time"
                value={t}
                style={{ padding: "6px 8px", border: "1.5px solid var(--border-input)", borderRadius: 8, fontFamily: "inherit" }}
                onChange={(e) => {
                  const next = [...times];
                  next[i] = e.target.value;
                  setTimes(next);
                }}
              />
              {times.length > 1 && (
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
                  onClick={() => setTimes(times.filter((_, idx) => idx !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {times.length < 4 && (
            <button className="activity-chip" style={{ marginBottom: 12 }} onClick={() => setTimes([...times, "12:00"])}>
              + Add time
            </button>
          )}
        </>
      )}

      {message && (
        <div style={{ fontSize: "12.5px", marginBottom: 10, color: message === "Saved ✓" ? "#4a8" : "var(--color-error)" }}>
          {message}
        </div>
      )}

      <button className="save-btn" style={{ width: "100%" }} onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save notification settings"}
      </button>
    </div>
  );
}

interface ProfileModalProps {
  username: string;
  pinLength: number;
  onClose: () => void;
  onSignOut: () => void;
  /** OCR-based import is gated to owner + own-API-key users. */
  canUseOcr: boolean;
  onOpenBulkImport: () => void;
  personas: PersonaMeta[];
  personaId: string;
  onPersonaChange: (id: string) => void;
  customInstructions: string;
  onInstructionsChange: (text: string) => void;
  personaLocked: boolean;
}

export default function ProfileModal({ username, pinLength: initialPinLength, onClose, onSignOut, canUseOcr, onOpenBulkImport, personas, personaId, onPersonaChange, customInstructions, onInstructionsChange, personaLocked }: ProfileModalProps) {
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
            {step === "menu" ? "👤 Profile" : step === "notifications" ? "🔔 Notifications" : step === "companion" ? "🤖 AI Companion" : "🔑 Change PIN"}
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
              onClick={() => setStep("companion")}
            >
              🤖 AI Companion
            </button>

            <button
              className="modal-close-btn"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => setStep("notifications")}
            >
              🔔 Notification Settings
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

        {step === "notifications" && <NotificationSettingsPanel />}

        {step === "companion" && (
          <CompanionPanel
            personas={personas}
            personaId={personaId}
            onPersonaChange={onPersonaChange}
            customInstructions={customInstructions}
            onInstructionsChange={onInstructionsChange}
            personaLocked={personaLocked}
          />
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
