import { useState, useRef } from "react";
import CameraCapture from "./CameraCapture";
import { useDictation } from "../hooks/useDictation";

const ACTIVITIES: { icon: string; label: string }[] = [
  { icon: "🪞", label: "Reflecting" },   // default — always first
  { icon: "🧘", label: "Sitting alone" },
  { icon: "🏋️", label: "Working out" },
  { icon: "🚶", label: "Walking" },
  { icon: "▶️", label: "Watching a video" },
  { icon: "📖", label: "Reading" },
  { icon: "💬", label: "In conversation" },
  { icon: "🌅", label: "Just woke up" },
  { icon: "🌙", label: "Can't sleep" },
  { icon: "🚿", label: "In the shower" },
];

// Maps a mood score to a color from the existing CSS palette
const MOOD_COLORS: Record<number, string> = {
  1: "#e05", 2: "#e35", 3: "#e64", 4: "#e94",
  5: "#eb3", 6: "#cb4", 7: "#9b4", 8: "#6b4", 9: "#4a4", 10: "#2a4",
};

// Labels matching ai-provider.ts (for the slider display — same vocabulary)
const MOOD_LABEL_HINTS: Record<number, string> = {
  1: "Devastated", 2: "Distressed", 3: "Down", 4: "Low",
  5: "Neutral", 6: "Steady", 7: "Calm", 8: "Hopeful", 9: "Energized", 10: "Joyful",
};

interface EntryFormProps {
  onSave: (text: string, activity: string, moodUser: number | null) => Promise<void>;
  saving: boolean;
  customTags?: string[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  /** OCR is gated to owner + own-API-key users. */
  canUseOcr: boolean;
}

export default function EntryForm({ onSave, saving, customTags = [], onAddTag, onRemoveTag, canUseOcr }: EntryFormProps) {
  const [thought, setThought] = useState("");
  const [activity, setActivity] = useState("Reflecting"); // default always selected
  const [moodUser, setMoodUser] = useState<number | null>(null); // null = untouched (AI will decide)
  const [sliderTouched, setSliderTouched] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState("");
  const newTagRef = useRef<HTMLInputElement | null>(null);

  // Voice dictation (Feature 9) — finalized speech appends to the thought field
  const dictation = useDictation((finalText) => {
    setThought((prev) => (prev && !prev.endsWith(" ") ? prev + " " : prev) + finalText);
  });

  // OCR text lands in the field for review before saving (Feature 7)
  const handleOcrText = (text: string) => {
    setThought((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
  };

  const getActivityLabel = (): string => {
    const match = ACTIVITIES.find((a) => a.label === activity);
    if (match) return `${match.icon} ${match.label}`;
    // custom tag — already has emoji prefix from storage
    return activity;
  };

  const handleSave = async () => {
    if (!thought.trim()) return;
    await onSave(thought.trim(), getActivityLabel(), sliderTouched ? moodUser : null);
    setThought("");
    setActivity("Reflecting");
    setMoodUser(null);
    setSliderTouched(false);
  };

  const handleChipClick = (label: string) => {
    // Must always have at least one selected — clicking selected chip does nothing
    if (activity === label) return;
    setActivity(label);
  };

  const handleAddTag = async () => {
    const tag = newTag.trim();
    if (!tag) return;
    if (tag.length > 30) { setTagError("Max 30 characters"); return; }
    setTagError("");
    try {
      await onAddTag(tag);
      setNewTag("");
      setAddingTag(false);
    } catch (e) {
      setTagError((e as Error).message || "Failed to add tag");
    }
  };

  const startAddTag = () => {
    setAddingTag(true);
    setNewTag("");
    setTagError("");
    setTimeout(() => newTagRef.current?.focus(), 50);
  };

  const moodColor = (moodUser != null && MOOD_COLORS[moodUser]) || "var(--text-tertiary)";
  const moodHint = sliderTouched && moodUser != null ? MOOD_LABEL_HINTS[moodUser] : null;

  return (
    <div>
      <div className="panel-title">Capture a Thought</div>
      <div className="panel-sub">What's on your mind right now?</div>

      <textarea
        className="entry-textarea"
        placeholder="Write freely..."
        value={thought}
        onChange={(e) => setThought(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
        }}
      />
      {dictation.listening && (
        <div className="dictation-live">
          🎙 Listening{dictation.interim ? `: "${dictation.interim}"` : "..."}
        </div>
      )}
      {dictation.error && <div className="tag-error">{dictation.error}</div>}

      {/* Activity chips */}
      <div className="activity-label">Where were you when this came to you?</div>
      <div className="activity-grid">
        {ACTIVITIES.map((a) => (
          <button
            key={a.label}
            className={`activity-chip ${activity === a.label ? "activity-chip--selected" : ""}`}
            onClick={() => handleChipClick(a.label)}
          >
            {a.icon} {a.label}
          </button>
        ))}

        {/* Custom tag chips */}
        {customTags.map((tag) => (
          <div key={tag} className="custom-tag-wrapper">
            <button
              className={`activity-chip custom-tag-chip ${activity === tag ? "activity-chip--selected" : ""}`}
              onClick={() => handleChipClick(tag)}
            >
              🏷 {tag}
            </button>
            <button
              className="custom-tag-remove"
              title={`Remove "${tag}"`}
              onClick={(e) => { e.stopPropagation(); onRemoveTag(tag); }}
            >
              ✕
            </button>
          </div>
        ))}

        {/* Add tag */}
        {addingTag ? (
          <div className="add-tag-row">
            <input
              ref={newTagRef}
              className="add-tag-input"
              placeholder="e.g. Swimming"
              value={newTag}
              maxLength={30}
              onChange={(e) => { setNewTag(e.target.value); setTagError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
                if (e.key === "Escape") { setAddingTag(false); setNewTag(""); }
              }}
            />
            <button className="add-tag-save" onClick={handleAddTag}>Add</button>
            <button className="add-tag-cancel" onClick={() => { setAddingTag(false); setNewTag(""); }}>✕</button>
          </div>
        ) : (
          <button className="activity-chip add-tag-btn" onClick={startAddTag}>+ Add tag</button>
        )}
      </div>

      {tagError && <div className="tag-error">{tagError}</div>}

      {/* Mood slider */}
      <div className="mood-slider-section">
        <div className="mood-slider-header">
          <span className="mood-slider-label">How are you actually feeling?</span>
          {sliderTouched ? (
            <span className="mood-slider-value" style={{ color: moodColor }}>
              {moodUser} · {moodHint}
              <button
                className="mood-slider-reset"
                onClick={() => { setMoodUser(null); setSliderTouched(false); }}
                title="Let AI decide"
              >
                ✕
              </button>
            </span>
          ) : (
            <span className="mood-slider-hint">optional — AI will score if skipped</span>
          )}
        </div>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={sliderTouched && moodUser != null ? moodUser : 5}
          className="mood-slider"
          style={{ "--slider-color": sliderTouched ? moodColor : "var(--border-medium)" } as React.CSSProperties}
          onChange={(e) => {
            setSliderTouched(true);
            setMoodUser(parseInt(e.target.value, 10));
          }}
        />
        <div className="mood-slider-ticks">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <span key={n} className="mood-slider-tick">{n}</span>
          ))}
        </div>
      </div>

      <div className="entry-actions-row">
        <CameraCapture canUseOcr={canUseOcr} onText={handleOcrText} />
        {dictation.supported && (
          <button
            className={`entry-tool-btn ${dictation.listening ? "entry-tool-btn--active" : ""}`}
            onClick={dictation.toggle}
            title={dictation.listening ? "Stop dictation" : "Dictate your thought"}
          >
            🎤
          </button>
        )}
        <button className="save-btn" style={{ flex: 1 }} onClick={handleSave} disabled={saving || !thought.trim()}>
          {saving ? "Saving..." : "Save Entry"}
        </button>
      </div>
    </div>
  );
}
