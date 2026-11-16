import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { storageGet, storageSet } from "../api";

/**
 * The draggable divider of the wide layout: the journal panel's width as a
 * percentage (25–70), remembered on this device.
 */
export function usePanelResize() {
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    parseFloat(storageGet("arc_panel_width") || "") || 45
  );
  const isDragging = useRef(false);
  const panelWidthRef = useRef(panelWidth);
  const splitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitRef.current) return;
      if (window.innerWidth <= 768) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(70, Math.max(25, pct));
      setPanelWidth(clamped);
      panelWidthRef.current = clamped;
    };
    const onUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        storageSet("arc_panel_width", String(panelWidthRef.current));
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  /** onMouseDown of the divider. */
  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return { panelWidth, splitRef, startResize };
}
