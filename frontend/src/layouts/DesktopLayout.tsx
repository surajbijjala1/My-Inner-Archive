import type { MouseEvent, ReactNode, RefObject } from "react";

interface DesktopLayoutProps {
  /** Width of the left panel, as a percentage of the split. */
  panelWidth: number;
  splitRef: RefObject<HTMLDivElement | null>;
  onResizeStart: (e: MouseEvent) => void;
  /** The current destination (never the chat — it has its own panel here). */
  panel: ReactNode;
  chat: ReactNode;
}

/**
 * A wide page, drawn as an open book: the destination on the left page, the
 * chat on the right page, and the spine between them, which can be dragged.
 */
export default function DesktopLayout({ panelWidth, splitRef, onResizeStart, panel, chat }: DesktopLayoutProps) {
  return (
    <div
      className="split-layout book desktop-only"
      ref={splitRef}
      style={{ display: "flex", overflow: "hidden" }}
    >
      <div className="panel-left" style={{ flex: `0 0 ${panelWidth}%`, width: `${panelWidth}%` }}>
        {panel}
      </div>

      <div className="panel-resizer" onMouseDown={onResizeStart} />

      {/* The right page. The cover opens onto exactly this box (DiaryScene). */}
      <div className="book-page-right" data-book-landing>
        {chat}
      </div>

      {/* The other pages of the book, seen edge-on down each side. */}
      <div className="book-stack book-stack--left" aria-hidden="true" />
      <div className="book-stack book-stack--right" aria-hidden="true" />
    </div>
  );
}
