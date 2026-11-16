import { useCallback, useState } from "react";
import type { NoticeMessage } from "../components/Notice";

/**
 * Everything that sits over the page: the sheets, the "go to" menu and the
 * error notice. Kept together so signing out can close them all at once.
 */
export function useOverlays() {
  const [navOpen, setNavOpen] = useState(false);
  const [showOTD, setShowOTD] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const showNotice = useCallback((text: string) => setNotice({ text, tone: "error" }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  /** For an expired session: nothing is left open over the sign-in page. */
  const closeAll = useCallback(() => {
    setShowProfile(false);
    setShowChats(false);
    setShowBulkImport(false);
    setShowOTD(false);
    setNavOpen(false);
    setNotice(null);
  }, []);

  return {
    navOpen, setNavOpen,
    showOTD, setShowOTD,
    showChats, setShowChats,
    showProfile, setShowProfile,
    showBulkImport, setShowBulkImport,
    notice, showNotice, dismissNotice,
    closeAll,
  };
}

export type Overlays = ReturnType<typeof useOverlays>;
