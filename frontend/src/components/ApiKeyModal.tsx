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
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">🔑 Add Your API Key</div>
        <div className="modal-subtitle">
          You've used your 10 free AI messages. To keep chatting with your archive, add your own
          Google Gemini API key — it's stored securely and only used for your account.
        </div>

        <div
          style={{
            fontSize: "13px",
            color: "var(--text-tertiary)",
            background: "var(--bg-tertiary)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
            marginBottom: 16,
            lineHeight: 1.65,
          }}
        >
          Get a free key at{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-primary)", fontWeight: 600 }}
          >
            aistudio.google.com/app/apikey
          </a>{" "}
          → Create API Key. The free tier gives you 1,500 requests/day — more than enough for
          personal journaling.
        </div>

        <input
          style={{
            width: "100%",
            padding: "10px 13px",
            border: "1.5px solid var(--border-input)",
            borderRadius: "var(--radius-md)",
            fontSize: "13px",
            fontFamily: "inherit",
            outline: "none",
            boxSizing: "border-box",
            marginBottom: 10,
          }}
          placeholder="AI..."
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />

        {error && (
          <div style={{ color: "var(--color-error)", fontSize: "12.5px", marginBottom: 10 }}>
            {error}
          </div>
        )}

        <button
          className="modal-close-btn"
          style={{ width: "100%", marginTop: 0 }}
          onClick={handleSave}
          disabled={saving || !keyInput.trim()}
        >
          {saving ? "Saving..." : "Save & Continue"}
        </button>

        <button
          onClick={onDismiss}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "9px 0",
            background: "none",
            border: "1px solid var(--border-medium)",
            borderRadius: "9px",
            cursor: "pointer",
            fontSize: "13px",
            color: "var(--text-tertiary)",
            fontFamily: "inherit",
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
