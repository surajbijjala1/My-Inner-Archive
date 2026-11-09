import type { Destination } from "../types";

const DESTINATIONS: Destination[] = ["journal", "chat", "patterns", "settings"];

const LABELS: Record<Destination, string> = {
  journal: "Journal",
  chat: "Chat",
  patterns: "Patterns",
  settings: "Settings",
};

/** The underline beside wherever you currently are — drawn, not ruled. */
const HereMark = () => (
  <svg className="nav-here" width="20" height="10" viewBox="0 0 20 10" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M2 5.4c5-1 10-1.2 15.5-.6" />
  </svg>
);

interface PageNavProps {
  current: Destination;
  onGo: (d: Destination) => void;
  onClose: () => void;
}

/**
 * Where to. The page itself recedes behind these four words rather than
 * being covered by a menu — so the overlay carries no surface of its own.
 */
export default function PageNav({ current, onGo, onClose }: PageNavProps) {
  return (
    <div
      className="nav-overlay"
      role="dialog"
      aria-label="Go to"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <nav className="nav-words" onClick={(e) => e.stopPropagation()}>
        {DESTINATIONS.map((d) => (
          <button
            key={d}
            className={`nav-word ${d === current ? "nav-word--current" : ""}`}
            aria-current={d === current ? "page" : undefined}
            onClick={() => {
              onGo(d);
              onClose();
            }}
          >
            {d === current && <HereMark />}
            {LABELS[d]}
          </button>
        ))}
      </nav>
    </div>
  );
}
