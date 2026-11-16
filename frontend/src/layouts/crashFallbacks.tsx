import type { ReactNode } from "react";
import { CrashFallback } from "../components/ErrorBoundary";
import { hasDraft } from "../draft";

// One fallback per area, so a render error in the journal, the patterns or
// the chat leaves the other two standing. Each says only what is true: saved
// entries are on the server; the page being written is safe only if it
// reached this device's storage (see draft.ts).

const reloadPage = () => window.location.reload();

export type AreaFallback = (retry: () => void) => ReactNode;

export interface CrashFallbacks {
  journal: AreaFallback;
  patterns: AreaFallback;
  chat: AreaFallback;
  /** A sheet that breaks is closed over, not left as a hole in the page. */
  sheet: (close: () => void) => AreaFallback;
}

/**
 * @param draftOwner whose draft to look for when wording the journal's fallback
 * @param goToJournal moves to the journal (the fallback then retries)
 */
export function makeCrashFallbacks(draftOwner: string, goToJournal: () => void): CrashFallbacks {
  const backToJournal = (retry: () => void) => () => {
    goToJournal();
    retry();
  };

  return {
    journal: (retry) => (
      <CrashFallback
        variant="area"
        title="the journal couldn't be drawn"
        actions={[
          { label: "reload", onClick: reloadPage },
          { label: "try again", onClick: retry, primary: true },
        ]}
      >
        Something went wrong showing this page. Your saved entries are stored on the server and
        are not affected.{" "}
        {hasDraft(draftOwner)
          ? "The page you were writing is kept on this device and will come back with the writing view."
          : "If you were in the middle of writing, those words may not have been kept."}
      </CrashFallback>
    ),

    patterns: (retry) => (
      <CrashFallback
        variant="area"
        title="the patterns couldn't be drawn"
        actions={[
          { label: "reload", onClick: reloadPage },
          { label: "try again", onClick: retry },
          { label: "back to the journal", onClick: backToJournal(retry), primary: true },
        ]}
      >
        Something went wrong laying this page out. It only reads your journal — nothing in it
        has changed, and the rest of the app still works.
      </CrashFallback>
    ),

    chat: (retry) => (
      <div className="crash-in-chat">
        <CrashFallback
          variant="area"
          title="the conversation couldn't be drawn"
          actions={[
            { label: "reload", onClick: reloadPage },
            { label: "back to the journal", onClick: backToJournal(retry), phoneOnly: true },
            { label: "try again", onClick: retry, primary: true },
          ]}
        >
          Something went wrong showing this chat. Messages already sent are kept with your past
          conversations; one you were still typing may need typing again. Your journal is not
          affected.
        </CrashFallback>
      </div>
    ),

    sheet: (close) => () => (
      <CrashFallback
        variant="sheet"
        title="this couldn't be opened"
        actions={[
          { label: "reload", onClick: reloadPage },
          { label: "close", onClick: close, primary: true },
        ]}
      >
        Something went wrong drawing this sheet. The page behind it still works, and nothing
        you have saved is affected.
      </CrashFallback>
    ),
  };
}
