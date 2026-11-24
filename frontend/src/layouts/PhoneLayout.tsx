import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PAGE_TURN_MS } from "../motion";
import type { Destination } from "../types";

const ORDER: Destination[] = ["journal", "chat", "patterns", "settings"];

interface PhoneLayoutProps {
  /** Where we are. Going somewhere else turns the page. */
  destination: Destination;
  children: ReactNode;
}

interface Turn {
  /** Forward lifts the leaf away to the left; back lays it over from the left. */
  dir: "forward" | "back";
  n: number;
}

/**
 * A narrow page: one destination at a time, as a single page of the book.
 * Changing destination turns a leaf across it (a blank sheet swung on the
 * spine, transform and opacity only) while the new page is already beneath.
 */
export default function PhoneLayout({ destination, children }: PhoneLayoutProps) {
  const [shown, setShown] = useState(destination);
  const [turn, setTurn] = useState<Turn | null>(null);

  if (shown !== destination) {
    setShown(destination);
    // Closing Settings is a sheet coming down, not a page turning back.
    if (shown !== "settings") {
      setTurn({
        dir: ORDER.indexOf(destination) > ORDER.indexOf(shown) ? "forward" : "back",
        n: (turn?.n ?? 0) + 1,
      });
    }
  }

  // Timed rather than waiting for the animation to end: on a wide screen
  // this layout is hidden and its animation never runs.
  const turnN = turn?.n;
  useEffect(() => {
    if (turnN === undefined) return;
    const timer = setTimeout(() => setTurn(null), PAGE_TURN_MS + 60);
    return () => clearTimeout(timer);
  }, [turnN]);

  const isChat = destination === "chat";

  return (
    <div className="phone-book book mobile-only" data-book-landing>
      <div className={`mobile-content${isChat ? " mobile-content--chat" : ""}`}>
        {children}
      </div>
      <div className="book-stack book-stack--right" aria-hidden="true" />
      {turn && (
        <div
          key={turn.n}
          className={`page-leaf page-leaf--${turn.dir}`}
          style={{ animationDuration: `${PAGE_TURN_MS}ms` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
