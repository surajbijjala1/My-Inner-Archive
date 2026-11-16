import { useRef, useState } from "react";
import type { Destination } from "./types";

import PinPad from "./components/PinPad";
import type { EntryFormHandle } from "./components/EntryForm";
import TopActions from "./components/TopActions";
import { CrashFallback } from "./components/ErrorBoundary";
import PageNav from "./components/PageNav";
import ActionBar from "./components/ActionBar";
import WelcomeScreen from "./components/WelcomeScreen";
import { usePanelResize } from "./hooks/usePanelResize";
import { useOverlays } from "./hooks/useOverlays";
import { useJournal } from "./hooks/useJournal";
import { useChat } from "./hooks/useChat";
import { useProfile } from "./hooks/useProfile";
import { useArchiveSession } from "./hooks/useArchiveSession";
import DesktopLayout from "./layouts/DesktopLayout";
import PhoneLayout from "./layouts/PhoneLayout";
import Sheets from "./layouts/Sheets";
import { ChatArea, DestinationView, type AreaProps } from "./layouts/Areas";
import { makeCrashFallbacks } from "./layouts/crashFallbacks";
import { PHONE_LAYOUT } from "./layouts/layout";
import { exportEntries } from "./exportEntries";
import { play } from "./sounds";
import { hasWebSpeech, isNativeApp } from "./native";
import { dayKey } from "./utils";

/**
 * Orchestration only: the state lives in the hooks, the drawing in the
 * layouts and sheets. This file decides which screen shows and wires the
 * pieces to each other.
 */
export default function App() {
  // Hook order is effect order: panel listeners, font preference, launch,
  // then the expired-session handler.
  const { panelWidth, splitRef, startResize } = usePanelResize();
  const overlays = useOverlays();
  const { showNotice, navOpen, setNavOpen, setShowOTD, setShowChats, setShowProfile } = overlays;
  const journal = useJournal(showNotice);
  const chat = useChat(showNotice);
  const profile = useProfile(showNotice);

  // One destination drives both layouts: on a narrow page it is the whole
  // screen, on a wide one it fills the left panel beside the chat.
  const [destination, setDestination] = useState<Destination>("journal");
  const [voiceActive, setVoiceActive] = useState(false);

  const session = useArchiveSession({ journal, chat, profile, overlays, setDestination });

  // The journal renders twice — once in the desktop split, once in the phone
  // view — and CSS hides one. Each copy gets its own ref so the action bar
  // drives the copy that is actually on screen (a shared ref pointed at the
  // phone copy, so on desktop "+", voice and photo acted on a hidden form).
  const deskFormRef = useRef<EntryFormHandle | null>(null);
  const phoneFormRef = useRef<EntryFormHandle | null>(null);
  const visibleForm = () =>
    (window.matchMedia(PHONE_LAYOUT).matches ? phoneFormRef : deskFormRef).current;

  // ── Screens ──────────────────────────────────────────────────────────────

  if (session.screen === "loading") {
    return <div className="center-screen"><span className="loading-text loading-pulse">Loading...</span></div>;
  }

  if (session.screen === "welcome") {
    return (
      <WelcomeScreen
        onGetStarted={() => session.setScreen("setup")}
        onLogIn={() => session.setScreen("login")}
      />
    );
  }

  if (session.screen === "setup") {
    return (
      <PinPad
        mode="setup"
        onSuccess={session.handleSetup}
        onBack={() => session.setScreen("login")}
        error={session.authError}
      />
    );
  }
  if (session.screen === "login") {
    return <PinPad mode="login" onSuccess={session.handleLogin} error={session.authError} />;
  }

  if (session.screen === "unreachable") {
    return (
      <CrashFallback
        variant="page"
        title="couldn't reach your archive"
        actions={[
          { label: "lock", onClick: session.handleLock },
          { label: "try again", onClick: session.retryLoad, primary: true },
        ]}
      >
        It didn't answer just now — you may be offline, or the server may be slow to wake.
        You are still signed in, and nothing you have saved has been touched.
      </CrashFallback>
    );
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  const fallbacks = makeCrashFallbacks(profile.username, () => setDestination("journal"));
  const handleExport = () => exportEntries(journal.entries);

  const scrollToEntry = (id: string) => {
    setDestination("journal");
    journal.setHighlightEntryId(id);
    setTimeout(() => {
      document.getElementById(`entry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  };

  // Opening a day from the heatmap jumps to its first entry in the journal.
  const openDay = (date: string) => {
    const match = journal.entries.find((e) => dayKey(e.created_at) === dayKey(`${date}T12:00:00`));
    if (match) scrollToEntry(match.id);
    else setDestination("journal");
  };

  // Settings is a destination, but it is still the existing profile sheet;
  // leaving it returns you to the journal.
  const closeSettings = () => {
    setShowProfile(false);
    profile.setPrefError("");
    if (destination === "settings") setDestination("journal");
  };

  const go = (d: Destination) => {
    if (d !== destination) play("navigate");
    setDestination(d);
    if (d === "settings") setShowProfile(true);
  };

  /** On a wide page the chat has its own panel, so the left one never shows it. */
  const panelDestination: Destination = destination === "chat" ? "journal" : destination;

  const areas: AreaProps = {
    journal,
    profile,
    chat,
    fallbacks,
    formRefs: { desktop: deskFormRef, phone: phoneFormRef },
    onDictatingChange: setVoiceActive,
    onOpenOnThisDay: () => setShowOTD(true),
    onOpenDay: openDay,
    onOpenNav: () => setNavOpen(true),
    onOpenHistory: () => setShowChats(true),
  };

  // ── Main App ──────────────────────────────────────────────────────────────
  return (
    <div
      className="app-shell"
      style={{ "--panel-width": `${panelWidth}%` } as React.CSSProperties}
    >
      {/* Desktop: account corner above the split (a phone reaches these
          through Settings and the chat's "past chats"). */}
      <TopActions
        onChats={() => setShowChats(true)}
        onExport={handleExport}
        onProfile={() => setShowProfile(true)}
        onLock={session.handleLock}
      />

      <DesktopLayout
        panelWidth={panelWidth}
        splitRef={splitRef}
        onResizeStart={startResize}
        panel={<DestinationView {...areas} destination={panelDestination} layout="desktop" />}
        chat={<ChatArea {...areas} layout="desktop" />}
      />

      <PhoneLayout isChat={destination === "chat"}>
        <DestinationView {...areas} destination={destination} layout="phone" />
      </PhoneLayout>

      {navOpen && (
        <PageNav current={destination} onGo={go} onClose={() => setNavOpen(false)} />
      )}

      {destination !== "chat" && (
      <ActionBar
        menuOpen={navOpen}
        onMenu={() => setNavOpen((v) => !v)}
        onWrite={() => {
          setDestination("journal");
          journal.setWriting(true);
          setTimeout(() => visibleForm()?.focus(), 60);
        }}
        onVoice={() => {
          setDestination("journal");
          journal.setWriting(true);
          setTimeout(() => {
            visibleForm()?.focus();
            visibleForm()?.toggleDictation();
          }, 60);
        }}
        onPhoto={() => {
          setDestination("journal");
          journal.setWriting(true);
          setTimeout(() => {
            visibleForm()?.focus();
            visibleForm()?.openCamera();
          }, 60);
        }}
        voiceAvailable={isNativeApp() || hasWebSpeech()}
        voiceActive={voiceActive}
      />
      )}

      <Sheets
        overlays={overlays}
        journal={journal}
        chat={chat}
        profile={profile}
        fallbacks={fallbacks}
        onCloseSettings={closeSettings}
        onExport={handleExport}
        onLock={session.handleLock}
        onSignOut={session.handleSignOut}
      />
    </div>
  );
}
