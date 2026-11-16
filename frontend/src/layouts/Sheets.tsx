import BulkImportModal from "../components/BulkImportModal";
import ChatHistoryDrawer from "../components/ChatHistoryDrawer";
import ConfirmDialog from "../components/ConfirmDialog";
import ErrorBoundary from "../components/ErrorBoundary";
import Notice from "../components/Notice";
import OnThisDayModal from "../components/OnThisDayModal";
import ProfileModal from "../components/ProfileModal";
import type { Chat } from "../hooks/useChat";
import type { Journal } from "../hooks/useJournal";
import type { Overlays } from "../hooks/useOverlays";
import type { Profile } from "../hooks/useProfile";
import type { CrashFallbacks } from "./crashFallbacks";

interface SheetsProps {
  overlays: Overlays;
  journal: Journal;
  chat: Chat;
  profile: Profile;
  fallbacks: CrashFallbacks;
  /** Closing Settings also leaves the "settings" destination. */
  onCloseSettings: () => void;
  onExport: () => void;
  onLock: () => void;
  onSignOut: () => void;
}

/**
 * Everything drawn over the page, in stacking order: the sheets (each behind
 * its own error boundary), the delete confirmation, and the error notice.
 */
export default function Sheets({
  overlays, journal, chat, profile, fallbacks, onCloseSettings, onExport, onLock, onSignOut,
}: SheetsProps) {
  const {
    showOTD, setShowOTD, showChats, setShowChats, showProfile, setShowProfile,
    showBulkImport, setShowBulkImport, notice, dismissNotice,
  } = overlays;

  // Import is opened from Settings, so leaving it goes back there.
  const closeBulkImport = () => { setShowBulkImport(false); setShowProfile(true); };

  return (
    <>
      {showOTD && (
        <ErrorBoundary area="on-this-day" fallback={fallbacks.sheet(() => setShowOTD(false))}>
          <OnThisDayModal entries={journal.onThisDay} onClose={() => setShowOTD(false)} />
        </ErrorBoundary>
      )}
      {showChats && (
        <ErrorBoundary area="chat-history" fallback={fallbacks.sheet(() => setShowChats(false))}>
          <ChatHistoryDrawer
            currentSessionId={chat.sessionId}
            onClose={() => setShowChats(false)}
            onResumeSession={(session) => chat.resumeSession(session, () => setShowChats(false))}
            personas={profile.personas}
          />
        </ErrorBoundary>
      )}
      {showProfile && (
        <ErrorBoundary area="settings" fallback={fallbacks.sheet(onCloseSettings)}>
          <ProfileModal
            username={profile.username}
            pinLength={profile.pinLength}
            onClose={onCloseSettings}
            onSignOut={onSignOut}
            canUseOcr={profile.canUseOcr}
            onOpenBulkImport={() => { setShowProfile(false); setShowBulkImport(true); }}
            personas={profile.personas}
            personaId={profile.personaId}
            onPersonaChange={profile.setPersonaId}
            customInstructions={profile.customInstructions}
            onInstructionsChange={profile.setCustomInstructions}
            personaLocked={chat.chatMsgs.length > 0}
            onExport={onExport}
            onLock={onLock}
            fontPref={profile.fontPref}
            onFontPrefChange={profile.changeFontPref}
            lockOnClose={profile.lockOnClose}
            onLockOnCloseChange={profile.changeLockOnClose}
            themePref={profile.themePref}
            onThemeChange={profile.changeTheme}
            prefError={profile.prefError}
            onRetryPersonas={profile.loadPersonas}
          />
        </ErrorBoundary>
      )}
      {journal.entryToDelete && (
        <ConfirmDialog
          title="Tear out this page?"
          message="It will be gone from your archive for good. This can't be undone."
          excerpt={journal.entryToDelete.text}
          confirmLabel="tear it out"
          danger
          onConfirm={journal.confirmDelete}
          onCancel={journal.cancelDelete}
        />
      )}
      {showBulkImport && (
        <ErrorBoundary area="bulk-import" fallback={fallbacks.sheet(closeBulkImport)}>
          <BulkImportModal onClose={closeBulkImport} onImported={journal.refreshAfterImport} />
        </ErrorBoundary>
      )}
      {notice && <Notice notice={notice} onDismiss={dismissNotice} />}
    </>
  );
}
