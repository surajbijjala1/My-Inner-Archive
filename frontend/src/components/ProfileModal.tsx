import { useEffect, useState } from "react";
import { changePin, getNotificationSettings, saveNotificationSettings, setPersona, saveInstructions } from "../api";
import { isNativeApp } from "../native";
import type { FontPref, PersonaMeta } from "../types";

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

type ProfileStep =
  | "menu"
  | "change-current"
  | "change-new"
  | "change-confirm"
  | "success"
  | "notifications"
  | "persona"
  | "instructions";

/**
 * The settings sub-sheets follow the paper rules: everything the interface
 * says is handwritten; prose is kept only for explanations (and for each
 * persona's description, which is read, not scanned).
 */

interface PersonaPanelProps {
  personas: PersonaMeta[];
  personaId: string;
  onPersonaChange: (id: string) => void;
  /** True while the current chat has messages — switching is only offered on a fresh chat. */
  personaLocked: boolean;
}

function PersonaPanel({ personas, personaId, onPersonaChange, personaLocked }: PersonaPanelProps) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectPersona = async (id: string) => {
    if (id === personaId || switching || personaLocked) return;
    setSwitching(id);
    setError(null);
    try {
      await setPersona(id);
      onPersonaChange(id);
    } catch (e) {
      setError((e as Error).message || "couldn't switch just now — try again");
    }
    setSwitching(null);
  };

  return (
    <div>
      <p className="set-intro">
        choose who you talk to — every companion knows your journal and keeps the same
        safety lines; they differ in how they show up for you
      </p>

      {personaLocked && (
        <p className="sheet-note set-aside">
          you&rsquo;re mid-conversation, so switching waits — start a new chat to pick someone else
        </p>
      )}

      {personas.length === 0 && (
        <p className="sheet-error">couldn&rsquo;t load the companions — check your connection and reopen this</p>
      )}

      <ul className="persona-list">
        {personas.map((p) => {
          const selected = p.id === personaId;
          return (
            <li key={p.id}>
              <button
                className={`persona-opt${selected ? " persona-opt--on" : ""}`}
                onClick={() => selectPersona(p.id)}
                disabled={!!switching || personaLocked}
                aria-pressed={selected}
              >
                <span className="persona-opt-head">
                  <span className="persona-opt-name">
                    <span aria-hidden="true">{p.emoji}</span> {p.name}
                  </span>
                  <span className="persona-opt-meaning">{p.meaning}</span>
                  {switching === p.id ? (
                    <span className="persona-opt-mark">switching…</span>
                  ) : selected ? (
                    <span className="persona-opt-mark">&#10003; chosen</span>
                  ) : null}
                </span>
                <span className="persona-opt-desc">{p.description}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="sheet-error" role="alert">{error}</p>}
    </div>
  );
}

interface InstructionsPanelProps {
  customInstructions: string;
  onInstructionsChange: (text: string) => void;
}

const INSTRUCTIONS_MAX = 500;

function InstructionsPanel({ customInstructions, onInstructionsChange }: InstructionsPanelProps) {
  const [text, setText] = useState(customInstructions);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const unchanged = text.trim() === customInstructions.trim();

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveInstructions(text.trim());
      onInstructionsChange(text.trim());
      setStatus({ text: "saved" });
    } catch (e) {
      setStatus({ text: (e as Error).message || "couldn't save — try again", error: true });
    }
    setSaving(false);
  };

  return (
    <div>
      <p className="sheet-text">
        Your own words, given to every companion in every chat. Tell them how you like to be
        spoken to — for example &ldquo;keep replies short&rdquo;, &ldquo;don&rsquo;t ask more
        than one question&rdquo;, or &ldquo;I respond well to metaphors&rdquo;. They shape the
        tone; they can&rsquo;t change the safety lines.
      </p>

      <label className="set-hand-label" htmlFor="custom-instructions">how they should talk to you</label>
      <textarea
        id="custom-instructions"
        className="sheet-area sheet-area--lined"
        maxLength={INSTRUCTIONS_MAX}
        placeholder="write it the way you'd say it…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus(null);
        }}
      />
      <div className="set-count">
        {text.length}/{INSTRUCTIONS_MAX}
      </div>

      {status && (
        <p className={status.error ? "sheet-error" : "sheet-note"} role={status.error ? "alert" : "status"}>
          {status.text}
        </p>
      )}

      <div className="sheet-actions">
        <button className="sheet-btn sheet-btn--primary" onClick={save} disabled={saving || unchanged}>
          {saving ? "saving…" : "save"}
        </button>
      </div>
    </div>
  );
}

const DEFAULT_TIMES = ["08:00", "18:00"];
const MAX_TIMES = 4;

function NotificationSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [times, setTimes] = useState<string[]>(DEFAULT_TIMES);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    getNotificationSettings()
      .then((s) => {
        setEnabled(s.enabled);
        setTimes(s.times.length > 0 ? s.times : DEFAULT_TIMES);
      })
      .catch(() => setStatus({ text: "couldn't load your settings — reopen this to try again", error: true }))
      .finally(() => setLoading(false));
  }, []);

  const change = (next: () => void) => {
    next();
    setStatus(null);
  };

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveNotificationSettings({
        enabled,
        times,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setStatus({ text: "saved" });
    } catch (e) {
      setStatus({ text: (e as Error).message || "couldn't save — try again", error: true });
    }
    setSaving(false);
  };

  if (loading) {
    return <p className="sheet-note loading-pulse">finding your settings…</p>;
  }

  return (
    <div>
      <p className="sheet-text">
        Daily notifications resurface an uplifting moment from your own archive — high-mood
        entries and anything you&rsquo;ve starred &#9733;.
        {!isNativeApp() && (
          <> They arrive in the Android app; set them here and they apply once the app is on your phone.</>
        )}
      </p>

      <div className="set-row">
        <span className="set-name set-name--hand">daily reflection</span>
        <InkToggle on={enabled} onChange={(v) => change(() => setEnabled(v))} label="Daily notifications" />
      </div>

      {enabled && (
        <>
          <div className="set-row">
            <span className="set-name set-name--hand">how often</span>
            <span className="set-choices">
              <button
                className={`set-choice${times.length === 1 ? " set-choice--on" : ""}`}
                onClick={() => change(() => setTimes(["08:00"]))}
              >
                once a day
              </button>
              <button
                className={`set-choice${times.length === 2 ? " set-choice--on" : ""}`}
                onClick={() => change(() => setTimes(DEFAULT_TIMES))}
              >
                twice
              </button>
            </span>
          </div>

          <div className="set-row set-row--top">
            <span className="set-name set-name--hand">at</span>
            <ul className="notify-times">
              {times.map((t, i) => (
                <li key={i} className="notify-time">
                  <input
                    type="time"
                    className="notify-time-input"
                    value={t}
                    aria-label={`Reminder time ${i + 1}`}
                    onChange={(e) =>
                      change(() => {
                        const next = [...times];
                        next[i] = e.target.value;
                        setTimes(next);
                      })
                    }
                  />
                  {times.length > 1 && (
                    <button
                      className="notify-time-x"
                      aria-label={`Remove ${t}`}
                      onClick={() => change(() => setTimes(times.filter((_, idx) => idx !== i)))}
                    >
                      remove
                    </button>
                  )}
                </li>
              ))}
              {times.length < MAX_TIMES && (
                <li>
                  <button className="notify-time-add" onClick={() => change(() => setTimes([...times, "12:00"]))}>
                    + another time
                  </button>
                </li>
              )}
            </ul>
          </div>
        </>
      )}

      {status && (
        <p className={status.error ? "sheet-error" : "sheet-note"} role={status.error ? "alert" : "status"}>
          {status.text}
        </p>
      )}

      <div className="sheet-actions">
        <button className="sheet-btn sheet-btn--primary" onClick={save} disabled={saving}>
          {saving ? "saving…" : "save"}
        </button>
      </div>
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
  /** Moved here from the old header, which the paper design removes. */
  onExport: () => void;
  onLock: () => void;
  /** How entries are set, and whether the archive re-locks when you leave. */
  fontPref: FontPref;
  onFontPrefChange: (pref: FontPref) => void;
  lockOnClose: boolean;
  onLockOnCloseChange: (on: boolean) => void;
  /** Why a preference snapped back, when one did. */
  prefError: string;
}

/** The toggle is inked, not a switch. */
function InkToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className="ink-toggle"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <svg width="30" height="18" viewBox="0 0 30 18" fill="none" aria-hidden="true">
        <path d="M3 12.6c7-1.1 16.5-1.3 24-.5" stroke="oklch(0.78 0.014 68)"
          strokeWidth="1.3" strokeLinecap="round" />
        <circle cx={on ? 24 : 6} cy="8.4" r="5.4"
          fill={on ? "oklch(0.86 0.075 80)" : "oklch(0.95 0.008 82)"}
          stroke="oklch(0.66 0.02 62)" strokeWidth="1.2" />
      </svg>
    </button>
  );
}

const FONT_CHOICES: { id: FontPref; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "handwritten", label: "Handwritten" },
  { id: "plain", label: "Plain" },
];

export default function ProfileModal({ username, pinLength: initialPinLength, onClose, onSignOut, canUseOcr, onOpenBulkImport, personas, personaId, onPersonaChange, customInstructions, onInstructionsChange, personaLocked, onExport, onLock, fontPref, onFontPrefChange, lockOnClose, onLockOnCloseChange, prefError }: ProfileModalProps) {
  const [step, setStep] = useState<ProfileStep>("menu");
  /** Shown in place, instead of a browser alert, when the trial can't import. */
  const [ocrBlocked, setOcrBlocked] = useState(false);
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
        {/* The sheet names itself in prose; the way out is handwritten. */}
        <div className="sheet-head">
          <div className="modal-title">
            {step === "menu"
              ? "Settings"
              : step === "notifications"
                ? "Notifications"
                : step === "persona"
                  ? "Your companion"
                  : step === "instructions"
                    ? "Custom instructions"
                    : "Change PIN"}
          </div>
          <button className="sheet-back" onClick={step === "menu" ? onClose : reset}>
            {step === "menu" ? "done" : "back"}
          </button>
        </div>

        {step === "menu" && (
          <div>
            {prefError && <div className="set-error">{prefError}</div>}

            <div className="set-label">how it reads</div>
            <div className="set-row">
              <span className="set-name">Font</span>
              <span className="set-choices">
                {FONT_CHOICES.map((f) => (
                  <button
                    key={f.id}
                    className={`set-choice ${f.id === fontPref ? "set-choice--on" : ""}`}
                    onClick={() => onFontPrefChange(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </span>
            </div>

            <div className="set-rule" />

            <div className="set-label">your companion</div>
            <button className="set-row set-row--go" onClick={() => setStep("persona")}>
              <span className="set-name">Persona</span>
              <span className="set-note">new chats start with</span>
              <span className="set-value">
                {personas.find((p) => p.id === personaId)?.name ?? "Smriti"}
              </span>
            </button>
            <button className="set-row set-row--go" onClick={() => setStep("instructions")}>
              <span className="set-name">Custom instructions</span>
              <span className="set-note">for all four</span>
              <span className="set-value set-value--soft">
                {customInstructions.trim() ? "written" : "write them…"}
              </span>
            </button>

            <div className="set-rule" />

            <div className="set-label">privacy</div>
            <button className="set-row set-row--go" onClick={() => setStep("change-current")}>
              <span className="set-name">PIN</span>
              <span className="set-dots">{"\u2022".repeat(pinLength)}</span>
              <span className="set-value">Change</span>
            </button>
            <div className="set-row">
              <span className="set-name">Lock on close</span>
              <InkToggle on={lockOnClose} onChange={onLockOnCloseChange} label="Lock on close" />
            </div>

            <div className="set-rule" />

            <div className="set-label">notifications</div>
            <button className="set-row set-row--go" onClick={() => setStep("notifications")}>
              <span className="set-name">Daily reflection</span>
              <span className="set-value set-value--soft">when &amp; how often</span>
            </button>

            <div className="set-rule" />

            <div className="set-label">this archive</div>
            <div className="set-row">
              <span className="set-name">Signed in as</span>
              <span className="set-value">{username}</span>
            </div>
            <button
              className="set-row set-row--go"
              onClick={() => {
                if (!canUseOcr) {
                  setOcrBlocked(true);
                  return;
                }
                onOpenBulkImport();
              }}
            >
              <span className="set-name">Import a paper journal</span>
              <span className="set-value set-value--soft">photograph it</span>
            </button>
            {ocrBlocked && (
              <p className="sheet-note" role="status" style={{ margin: "0 0 var(--space-sm)" }}>
                reading photographed pages uses AI vision, which the free trial doesn't include —
                add your own Gemini key to unlock it
              </p>
            )}
            <button className="set-row set-row--go" onClick={onExport}>
              <span className="set-name">Export everything</span>
              <span className="set-value set-value--soft">as a file</span>
            </button>

            <div className="set-foot">
              <button className="set-foot-link" onClick={onLock}>lock now</button>
              <button className="set-foot-link" onClick={onSignOut}>sign out</button>
            </div>
          </div>
        )}

        {step === "notifications" && <NotificationSettingsPanel />}

        {step === "persona" && (
          <PersonaPanel
            personas={personas}
            personaId={personaId}
            onPersonaChange={onPersonaChange}
            personaLocked={personaLocked}
          />
        )}

        {step === "instructions" && (
          <InstructionsPanel
            customInstructions={customInstructions}
            onInstructionsChange={onInstructionsChange}
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
            <button className="sheet-back" onClick={onClose}>done</button>
          </div>
        )}
      </div>
    </div>
  );
}
