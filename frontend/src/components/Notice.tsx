import { useEffect } from "react";

export interface NoticeMessage {
  text: string;
  /** Errors are announced assertively and stay a little longer. */
  tone?: "info" | "error";
}

interface NoticeProps {
  notice: NoticeMessage;
  onDismiss: () => void;
}

/**
 * A slip of paper for things that went wrong (or need saying) outside any
 * open sheet — replaces native alert(), which shows as a "localhost says…"
 * system popup and inside the Android WebView blocks the whole app. Tap to
 * dismiss; it also fades on its own.
 */
export default function Notice({ notice, onDismiss }: NoticeProps) {
  const isError = notice.tone === "error";

  useEffect(() => {
    const t = setTimeout(onDismiss, isError ? 7000 : 4500);
    return () => clearTimeout(t);
  }, [notice, isError, onDismiss]);

  return (
    <div
      className={`notice-slip${isError ? " notice-slip--error" : ""}`}
      role={isError ? "alert" : "status"}
      onClick={onDismiss}
    >
      {notice.text}
    </div>
  );
}
