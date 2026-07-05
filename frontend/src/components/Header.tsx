interface HeaderProps {
  onThisDayCount: number;
  onShowOTD: () => void;
  onExport: () => void;
  onLock: () => void;
  onShowChats: () => void;
  onShowProfile: () => void;
}

export default function Header({ onThisDayCount, onShowOTD, onExport, onLock, onShowChats, onShowProfile }: HeaderProps) {
  return (
    <div className="header">
      <span className="header-logo">🌱 My Inner Archive</span>
      <div className="header-actions">
        {onThisDayCount > 0 && (
          <button className="header-btn header-btn--warm" onClick={onShowOTD}>
            <span className="header-btn-icon">📅</span>
            <span className="header-btn-text">On This Day</span>
          </button>
        )}
        <button className="header-btn" onClick={onShowChats} title="Chat history">
          <span className="header-btn-icon">💬</span>
          <span className="header-btn-text">Chats</span>
        </button>
        <button className="header-btn" onClick={onExport} title="Export entries">
          <span className="header-btn-icon">⬇</span>
          <span className="header-btn-text">Export</span>
        </button>
        <button className="header-btn" onClick={onShowProfile} title="Profile & settings">
          <span className="header-btn-icon">👤</span>
          <span className="header-btn-text">Profile</span>
        </button>
        <button className="header-btn" onClick={onLock} title="Lock session">
          <span className="header-btn-icon">🔒</span>
          <span className="header-btn-text">Lock</span>
        </button>
      </div>
    </div>
  );
}
