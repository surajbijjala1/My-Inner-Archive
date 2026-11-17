import { useRef, useState } from "react";
import type { Destination } from "./types";

import PinPad from "./components/PinPad";
import type { EntryFormHandle } from "./components/EntryForm";
import TopActions from "./components/TopActions";
import { CrashFallback } from "./components/ErrorBoundary";
import PageNav from "./components/PageNav";
import ActionBar from "./components/ActionBar";
import WelcomeScreen from "./components/WelcomeScreen";
import InkSplash from "./components/InkSplash";
import DiaryScene, { CoverWait } from "./components/DiaryScene";
import IntroVideo, { type IntroHandle } from "./components/IntroVideo";
import { useSceneFrame } from "./scene/useSceneFrame";
import { INTRO_FADE_MS } from "./motion";
import { useEntrance } from "./hooks/useEntrance";
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
  const { screen } = session;
  const entrance = useEntrance(screen);

  // The PIN pad stays on the diary's cover while the cover opens, so the
  // scene remembers which pad it was showing after the session has moved on.
  const [authMode, setAuthMode] = useState<"login" | "setup" | null>(null);
  const authNow = screen === "login" || screen === "setup" ? screen : screen === "app" ? authMode : null;
  if (authNow !== authMode) setAuthMode(authNow);
  // How much of the PIN is typed: the book's clasp lifts with it.
  const [pinProgress, setPinProgress] = useState(0);

  // Where the video's last frame sits in this window: the lock scene, the
  // video and the desk behind the app are all placed by it.
  const { scene: sceneSet, zoom: introZoom } = useSceneFrame();
  const introRef = useRef<IntroHandle | null>(null);

  /**
   * Leaving the entry page. On a cold start the intro video plays first (it
   * must be started here, inside the tap, to be allowed its sound); the form
   * is shown beneath it once the video's first frame covers the page.
   */
  const enter = (target: "setup" | "login") => {
    if (entrance.introWanted && introRef.current?.start()) {
      entrance.beginIntro();
      setTimeout(() => session.setScreen(target), INTRO_FADE_MS);
    } else {
      entrance.skipIntro();
      session.setScreen(target);
    }
  };

  // The journal renders twice — once in the desktop split, once in the phone
  // view — and CSS hides one. Each copy gets its own ref so the action bar
  // drives the copy that is actually on screen (a shared ref pointed at the
  // phone copy, so on desktop "+", voice and photo acted on a hidden form).
  const deskFormRef = useRef<EntryFormHandle | null>(null);
  const phoneFormRef = useRef<EntryFormHandle | null>(null);
  const visibleForm = () =>
    (window.matchMedia(PHONE_LAYOUT).matches ? phoneFormRef : deskFormRef).current;

  // ── Wiring ───────────────────────────────────────────────────────────────

  const fallbacks = makeCrashFallbacks(profile.username, () => setDestination("journal"));
  const handleExport = () => exportEntries(journal.entries);

  const scrollToEntry = (id: string) => {
    setDestination("journal");
    journal.flashEntry(id);
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

  /**
   * Open the writing view, then focus its form and do `then` with it. The
   * form mounts on the next render; wait for it frame by frame (a slow phone
   * can take longer than any fixed delay) and give up quietly after ~1.5s.
   */
  const openWriting = (then?: (form: EntryFormHandle) => void) => {
    setDestination("journal");
    journal.setWriting(true);
    let frames = 0;
    const tryForm = () => {
      const form = visibleForm();
      if (form) {
        form.focus();
        then?.(form);
      } else if (++frames < 90) {
        requestAnimationFrame(tryForm);
      }
    };
    requestAnimationFrame(tryForm);
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
  // The app is the open book. The lock scene is drawn over it rather than
  // instead of it, so the cover can swing open onto the app already in place.
  const inApp = screen === "app";
  const sceneOn = screen !== "unreachable" && entrance.stage !== "done";
  const scene = {
    stage: entrance.stage === "done" ? ("closed" as const) : entrance.stage,
    arrive: entrance.arrive,
    onSkip: entrance.skipOpening,
  };

  return (
    <>
      {inApp && (
        <div
          className="app-shell"
          style={{ "--panel-width": `${panelWidth}%`, "--panel-frac": panelWidth / 100 } as React.CSSProperties}
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

          <PhoneLayout destination={destination}>
            <DestinationView {...areas} destination={destination} layout="phone" />
          </PhoneLayout>

          {navOpen && (
            <PageNav current={destination} onGo={go} onClose={() => setNavOpen(false)} />
          )}

          {destination !== "chat" && (
          <ActionBar
            menuOpen={navOpen}
            onMenu={() => setNavOpen((v) => !v)}
            onWrite={() => openWriting()}
            onVoice={() => openWriting((form) => form.toggleDictation())}
            onPhoto={() => openWriting((form) => form.openCamera())}
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
      )}

      {screen === "unreachable" && (
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
      )}

      {screen === "welcome" && (
        <WelcomeScreen onGetStarted={() => enter("setup")} onLogIn={() => enter("login")} />
      )}

      {sceneOn && screen !== "welcome" && (
        entrance.introPlaying ? (
          // Under the video: the book alone. Its lettering waits for the video to end.
          <DiaryScene {...scene} />
        ) : authMode ? (
          // Same place in the tree for both forms, so the name typed in one
          // is still there in the other.
          <PinPad
            mode={authMode}
            onSuccess={authMode === "setup" ? session.handleSetup : session.handleLogin}
            onBack={authMode === "setup" ? () => session.setScreen("login") : undefined}
            onNew={() => session.setScreen("setup")}
            error={session.authError}
            onProgress={setPinProgress}
            frame={(parts) => (
              <DiaryScene
                {...scene}
                clasp={pinProgress}
                reveal={entrance.reveal}
                onRevealed={entrance.endReveal}
                {...parts}
              />
            )}
          />
        ) : (
          <DiaryScene {...scene} cover={<CoverWait />} />
        )
      )}

      {entrance.introWanted && sceneSet?.video && (
        <IntroVideo ref={introRef} scene={sceneSet} zoom={introZoom} onDone={entrance.endIntro} />
      )}

      {entrance.splash && <InkSplash onFade={entrance.fadeSplash} onDone={entrance.endSplash} />}
    </>
  );
}
