import type { ReactNode } from "react";

interface PhoneLayoutProps {
  /** The chat fills the page edge to edge, so it gets its own modifier. */
  isChat: boolean;
  children: ReactNode;
}

/** A narrow page: one destination at a time. */
export default function PhoneLayout({ isChat, children }: PhoneLayoutProps) {
  return (
    <div className={`mobile-content mobile-only${isChat ? " mobile-content--chat" : ""}`}>
      {children}
    </div>
  );
}
