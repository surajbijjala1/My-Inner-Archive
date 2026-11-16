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

/** A wide page: the destination on the left, the chat on the right, a draggable divider between. */
export default function DesktopLayout({ panelWidth, splitRef, onResizeStart, panel, chat }: DesktopLayoutProps) {
  return (
    <div
      className="split-layout desktop-only"
      ref={splitRef}
      style={{ display: "flex", overflow: "hidden" }}
    >
      <div className="panel-left" style={{ flex: `0 0 ${panelWidth}%`, width: `${panelWidth}%` }}>
        {panel}
      </div>

      <div className="panel-resizer" onMouseDown={onResizeStart} />

      {chat}
    </div>
  );
}
