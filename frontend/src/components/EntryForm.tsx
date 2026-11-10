import { useState, useRef, useImperativeHandle, forwardRef } from "react";
import CameraCapture, { type CameraCaptureHandle } from "./CameraCapture";
import { useDictation } from "../hooks/useDictation";
import { tagLabel } from "../utils";

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

/**
 * The slider is drawn as a continuous run from heavy to light with no
 * numbers on it, but the API still takes 1-10, so the position is mapped
 * back to a score on change. 5 is the untouched resting point.
 */
const MOOD_MIN = 1;
const MOOD_MAX = 10;

/**
 * The page that scrolls differs by width: the left panel on a wide screen,
 * the single content column on a narrow one. Find whichever it is.
 */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export interface EntryFormHandle {
  focus: () => void;
  toggleDictation: () => void;
  openCamera: () => void;
}

interface EntryFormProps {
  /** Resolves true once the entry is stored; false keeps the draft on the page. */
  onSave: (text: string, activity: string, moodUser: number | null) => Promise<boolean>;
  saving: boolean;
  customTags?: string[];
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  /** OCR is gated to owner + own-API-key users. */
  canUseOcr: boolean;
}

/**
 * Writing happens on the page itself — no form, no box. Tags and the mood
 * run appear beneath the line as if they had always been there, and the
 * entry is finished by letting it rest.
 */
const EntryForm = forwardRef<EntryFormHandle, EntryFormProps>(function EntryForm(
  { onSave, saving, customTags = [], onAddTag, onRemoveTag, canUseOcr },
  ref
) {
  const [thought, setThought] = useState("");
  const [activity, setActivity] = useState("Reflecting"); // default always selected
  const [moodUser, setMoodUser] = useState<number | null>(null); // null = untouched (AI will decide)
  const [sliderTouched, setSliderTouched] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState("");
  const newTagRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const cameraRef = useRef<CameraCaptureHandle | null>(null);

  // Voice dictation — finalized speech appends to the thought field
  const dictation = useDictation((finalText) => {
    setThought((prev) => (prev && !prev.endsWith(" ") ? prev + " " : prev) + finalText);
  });

  // The bottom action bar drives writing, voice and photo from outside.
  useImperativeHandle(ref, () => ({
    // Entering the writing view from part-way down the journal should return
    // the page to its top — scrolling the line itself into view would park it
    // at the edge and hide the date above it.
    focus: () => {
      // The view inserts above the journal; the page returns to its top so
      // the date and the line are what you land on. Scroll anchoring is off
      // on the scroller (index.css), so this assignment holds.
      const page = scrollParentOf(textRef.current);
      if (page) page.scrollTop = 0;
      textRef.current?.focus({ preventScroll: true });
    },
    toggleDictation: () => dictation.toggle(),
    openCamera: () => cameraRef.current?.open(),
  }));

  // OCR text lands in the field for review before saving
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
    const saved = await onSave(thought.trim(), getActivityLabel(), sliderTouched ? moodUser : null);
    if (!saved) return; // failed — never wipe words that aren't stored anywhere
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
    if (tag.length > 30) { setTagError("that's a long one — 30 characters"); return; }
    setTagError("");
    try {
      await onAddTag(tag);
      setNewTag("");
      setAddingTag(false);
    } catch (e) {
      setTagError((e as Error).message || "couldn't add that one");
    }
  };

  const startAddTag = () => {
    setAddingTag(true);
    setNewTag("");
    setTagError("");
    setTimeout(() => newTagRef.current?.focus(), 50);
  };

  const sliderValue = sliderTouched && moodUser != null ? moodUser : 5;
  const moodPercent = ((sliderValue - MOOD_MIN) / (MOOD_MAX - MOOD_MIN)) * 100;

  /** Tags sit at slight angles, as if written by hand at different moments. */
  const tilt = (i: number) => `${((i * 47) % 9) - 4}deg`;

  return (
    <div className="writing">
      <textarea
        ref={textRef}
        className="writing-line"
        placeholder="start anywhere — a name, the weather, what you ate…"
        value={thought}
        rows={3}
        onChange={(e) => setThought(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
        }}
      />

      {dictation.listening && (
        <div className="writing-aside">
          listening{dictation.interim ? `: ${dictation.interim}` : "…"}
        </div>
      )}
      {dictation.error && <div className="writing-aside writing-aside--error">{dictation.error}</div>}

      <div className="writing-label">where were you?</div>
      <div className="tag-run">
        {ACTIVITIES.map((a, i) => (
          <button
            key={a.label}
            className={`tag ${activity === a.label ? "tag--on" : ""}`}
            style={{ transform: `rotate(${tilt(i)})` }}
            onClick={() => handleChipClick(a.label)}
          >
            {a.label}
          </button>
        ))}

        {customTags.map((tag, i) => (
          <span key={tag} className="tag-custom">
            <button
              className={`tag ${activity === tag ? "tag--on" : ""}`}
              style={{ transform: `rotate(${tilt(i + ACTIVITIES.length)})` }}
              onClick={() => handleChipClick(tag)}
            >
              {tagLabel(tag)}
            </button>
            <button
              className="tag-remove"
              title={`Remove "${tagLabel(tag)}"`}
              onClick={(e) => { e.stopPropagation(); onRemoveTag(tag); }}
              aria-label={`Remove ${tagLabel(tag)}`}
            >
              ×
            </button>
          </span>
        ))}

        {addingTag ? (
          <span className="tag-add-row">
            <input
              ref={newTagRef}
              className="tag-add-input"
              placeholder="swimming…"
              value={newTag}
              maxLength={30}
              onChange={(e) => { setNewTag(e.target.value); setTagError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddTag();
                if (e.key === "Escape") { setAddingTag(false); setNewTag(""); }
              }}
            />
            <button className="tag" onClick={handleAddTag}>keep</button>
            <button className="tag" onClick={() => { setAddingTag(false); setNewTag(""); }}>
              never mind
            </button>
          </span>
        ) : (
          <button className="tag tag--add" onClick={startAddTag} aria-label="Add a tag">+</button>
        )}
      </div>

      {tagError && <div className="writing-aside writing-aside--error">{tagError}</div>}

      <div className="writing-label">how are you actually feeling?</div>
      <div className="mood-run">
        <span className="mood-run-end">heavy</span>
        <div className="mood-run-track">
          <div className="mood-run-rail" />
          <div
            className={`mood-run-thumb ${sliderTouched ? "mood-run-thumb--set" : ""}`}
            style={{ left: `${moodPercent}%` }}
          />
          <input
            type="range"
            min={MOOD_MIN}
            max={MOOD_MAX}
            step="1"
            value={sliderValue}
            className="mood-run-input"
            aria-label="How are you actually feeling?"
            onChange={(e) => {
              setSliderTouched(true);
              setMoodUser(parseInt(e.target.value, 10));
            }}
          />
        </div>
        <span className="mood-run-end">light</span>
      </div>
      <div className="writing-hint">
        {sliderTouched ? (
          <button
            className="writing-hint-reset"
            onClick={() => { setMoodUser(null); setSliderTouched(false); }}
          >
            let me read it instead
          </button>
        ) : (
          "optional — I'll read it from your words if you skip"
        )}
      </div>

      {/* Camera is opened from the action bar; it renders no control of its own. */}
      <CameraCapture ref={cameraRef} canUseOcr={canUseOcr} onText={handleOcrText} />

      <div className="writing-finish">
        <button className="rest-btn" onClick={handleSave} disabled={saving || !thought.trim()}>
          <span>{saving ? "setting it down…" : "let it rest"}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="18" y2="12" />
            <polyline points="12 6 18 12 12 18" />
          </svg>
        </button>
      </div>
    </div>
  );
});

export default EntryForm;
