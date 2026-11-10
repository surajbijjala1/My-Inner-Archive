import { useState } from "react";
import { saveApiKey } from "../api";

interface ApiKeyModalProps {
  onSaved: () => void;
  onDismiss: () => void;
}

export default function ApiKeyModal({ onSaved, onDismiss }: ApiKeyModalProps) {
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError("");
    try {
      await saveApiKey(keyInput.trim());
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Failed to save key.");
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apikey-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 400 }}
      >
        <div className="modal-title" id="apikey-title">Your own key</div>
        <p className="sheet-text">
          You've used the free messages. To keep talking with your archive, add a Google
          Gemini API key of your own. It's encrypted before it's stored, and only used for
          your account.
        </p>
        <p className="sheet-note" style={{ marginBottom: "var(--space-lg)" }}>
          get one free at{" "}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
            aistudio.google.com
          </a>{" "}
          → create API key. the free tier is plenty for a journal.
        </p>

        <input
          className="sheet-field"
          placeholder="paste your key"
          aria-label="Gemini API key"
          autoComplete="off"
          spellCheck={false}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        {error && <p className="sheet-error" role="alert">{error}</p>}

        <div className="sheet-actions">
          <button className="sheet-btn" onClick={onDismiss}>not now</button>
          <button
            className="sheet-btn sheet-btn--primary"
            onClick={handleSave}
            disabled={saving || !keyInput.trim()}
          >
            {saving ? "saving…" : "save & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
