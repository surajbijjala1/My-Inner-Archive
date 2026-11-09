/**
 * The four things you can always do, drawn at the foot of every page:
 * open the menu, start writing, speak instead, or photograph a page.
 * Icons are inked by hand — see the wobble in the menu strokes.
 */

const MenuIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <path d="M5 8.5c4.7-.6 9.3-.6 14-.2" />
    <path d="M5.5 12.3c4.2-.45 8.5-.5 13-.15" />
    <path d="M5 16.1c4.9-.55 9.4-.45 13.7-.05" />
  </svg>
);

const WriteIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const VoiceIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <rect x="9.5" y="3.5" width="5" height="9.5" rx="2.5" />
    <line x1="12" y1="16" x2="12" y2="19.5" />
    <line x1="9" y1="19.5" x2="15" y2="19.5" />
  </svg>
);

const PhotoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="7" width="16" height="12" rx="2" />
    <circle cx="12" cy="13" r="3" />
    <line x1="8" y1="7" x2="9.5" y2="4.8" />
  </svg>
);

interface ActionBarProps {
  onMenu: () => void;
  onWrite: () => void;
  onVoice: () => void;
  onPhoto: () => void;
  /** Dictation is unavailable on browsers without the Web Speech API. */
  voiceAvailable: boolean;
  voiceActive: boolean;
  menuOpen: boolean;
}

export default function ActionBar({
  onMenu,
  onWrite,
  onVoice,
  onPhoto,
  voiceAvailable,
  voiceActive,
  menuOpen,
}: ActionBarProps) {
  return (
    <div className="action-bar">
      <button
        className={`action-btn ${menuOpen ? "action-btn--on" : ""}`}
        onClick={onMenu}
        aria-label="Go to"
        aria-expanded={menuOpen}
      >
        <MenuIcon />
      </button>
      <button className="action-btn" onClick={onWrite} aria-label="New entry">
        <WriteIcon />
      </button>
      {voiceAvailable && (
        <button
          className={`action-btn ${voiceActive ? "action-btn--on" : ""}`}
          onClick={onVoice}
          aria-label={voiceActive ? "Stop dictation" : "Voice note"}
          aria-pressed={voiceActive}
        >
          <VoiceIcon />
        </button>
      )}
      <button className="action-btn" onClick={onPhoto} aria-label="Add photo">
        <PhotoIcon />
      </button>
    </div>
  );
}
