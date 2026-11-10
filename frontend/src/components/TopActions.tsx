/**
 * The account corner on a wide page: past chats, export, profile, lock.
 *
 * The redesign moved these behind the Settings sheet, which suits a phone but
 * left the desktop without its one-click lock and with no way into chat
 * history at all. Drawn as handwritten words with inked icons, matching the
 * rest of the paper chrome rather than the old boxed buttons.
 */

const ChatsIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 6.2c4.6-.7 9.4-.7 14 0 .6 2.6.6 5.2 0 7.7-3 .45-6 .5-9 .3L6.3 17.6l.4-3.3c-.6-.1-1.1-.2-1.7-.4-.6-2.6-.6-5.2 0-7.7z" />
  </svg>
);

const ExportIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4.5v10" />
    <path d="M8.2 11.2c1.3 1.2 2.5 2.4 3.8 3.6 1.3-1.2 2.5-2.4 3.8-3.6" />
    <path d="M5 17.5c4.7.5 9.3.55 14 .1" />
  </svg>
);

const ProfileIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8.6" r="3.4" />
    <path d="M5.5 19.2c.9-3.3 3.6-5 6.5-5s5.6 1.7 6.5 5" />
  </svg>
);

const LockIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5.5" y="10.5" width="13" height="9" rx="1.6" />
    <path d="M8.5 10.5V8.2a3.5 3.5 0 0 1 7 0v2.3" />
  </svg>
);

interface TopActionsProps {
  onChats: () => void;
  onExport: () => void;
  onProfile: () => void;
  onLock: () => void;
}

export default function TopActions({ onChats, onExport, onProfile, onLock }: TopActionsProps) {
  return (
    <nav className="top-actions desktop-only" aria-label="Account">
      <button className="top-action" onClick={onChats} title="Past conversations">
        <ChatsIcon />
        chats
      </button>
      <button className="top-action" onClick={onExport} title="Download your entries as text">
        <ExportIcon />
        export
      </button>
      <button className="top-action" onClick={onProfile} title="Profile and settings">
        <ProfileIcon />
        profile
      </button>
      <button className="top-action" onClick={onLock} title="Lock the archive">
        <LockIcon />
        lock
      </button>
    </nav>
  );
}
