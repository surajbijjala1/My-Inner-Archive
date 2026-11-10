import { useState, useEffect, useRef, useCallback } from "react";
import {
  hasToken, clearToken,
  getEntries, createEntry, deleteEntry,
  register, login, getMe,
  getChatMessages,
  addTag, removeTag,
  getStoredSessionId, storeSessionId, clearSessionId, getSessionMeta,
  getPersonas, setPersona as setPersonaApi,
} from "./api";
import type { ChatMessage, ChatSession, Destination, Entry, EntryMood, FontPref, PersonaMeta } from "./types";

import PinPad from "./components/PinPad";
import EntryForm, { type EntryFormHandle } from "./components/EntryForm";
import EntryList from "./components/EntryList";
import Patterns from "./components/Patterns";
import AiChat from "./components/AiChat";
import OnThisDayModal from "./components/OnThisDayModal";
import ChatHistoryDrawer from "./components/ChatHistoryDrawer";
import TopActions from "./components/TopActions";
import ProfileModal from "./components/ProfileModal";
import BulkImportModal from "./components/BulkImportModal";
import ConfirmDialog from "./components/ConfirmDialog";
import Notice, { type NoticeMessage } from "./components/Notice";
import PageNav from "./components/PageNav";
import ActionBar from "./components/ActionBar";
import { hasWebSpeech } from "./native";
import { initPush } from "./push";
import { setPreferences } from "./api";
import { dayKey, formatDayHeading } from "./utils";

type Screen = "loading" | "welcome" | "setup" | "login" | "app";

const FEATURES: [string, string, string][] = [
  ["📝", "Capture thoughts", "Write anything, any time. Timestamped and private."],
  ["🏷️", "Tag your context", "Record where you were when the insight hit."],
  ["📈", "Mood timeline", "See your emotional patterns over time, automatically."],
  ["🤖", "AI from your words", "Your archive answers with only your own words."],
  ["📅", "On This Day", "See what you wrote on this date in past years."],
];

/** Must match the phone breakpoint in index.css (.mobile-only / .desktop-only). */
const PHONE_LAYOUT = "(max-width: 768px)";
type Layout = "desktop" | "phone";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [entries, setEntries] = useState<Entry[]>([]);
  // One destination drives both layouts: on a narrow page it is the whole
  // screen, on a wide one it fills the left panel beside the chat.
  const [destination, setDestination] = useState<Destination>("journal");
  const [navOpen, setNavOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  // Writing is its own view in the design, reached with "+", not a form
  // permanently pinned above the journal.
  const [writing, setWriting] = useState(false);
  // The journal renders twice — once in the desktop split, once in the phone
  // view — and CSS hides one. Each copy gets its own ref so the action bar
  // drives the copy that is actually on screen (a shared ref pointed at the
  // phone copy, so on desktop "+", voice and photo acted on a hidden form).
  const deskFormRef = useRef<EntryFormHandle | null>(null);
  const phoneFormRef = useRef<EntryFormHandle | null>(null);
  const visibleForm = () =>
    (window.matchMedia(PHONE_LAYOUT).matches ? phoneFormRef : deskFormRef).current;
  const [onThisDay, setOnThisDay] = useState<Entry[]>([]);
  const [showOTD, setShowOTD] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<Entry | null>(null);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const showNotice = useCallback((text: string) => setNotice({ text, tone: "error" }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [saving, setSaving] = useState(false);
  const [authError] = useState("");

  // User / AI / session state
  const [username, setUsername] = useState("");
  const [chatCount, setChatCount] = useState(0);
  const [freeLimit, setFreeLimit] = useState(10);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [pinLength, setPinLength] = useState(4);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [personaId, setPersonaId] = useState("smriti");
  const [customInstructions, setCustomInstructions] = useState("");
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  // How entries are set, and whether the archive re-locks when you leave.
  const [fontPref, setFontPref] = useState<FontPref>("reading");
  const [lockOnClose, setLockOnClose] = useState(true);
  // Set when a preference could not be saved, so the sheet can say why the
  // choice snapped back instead of appearing to ignore the tap.
  const [prefError, setPrefError] = useState("");

  // Chat state — lifted here so it survives mobile tab switches
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Persona pinned to the resumed session (null = new chat → user's current pick)
  const [sessionPersonaId, setSessionPersonaId] = useState<string | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);

  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    parseFloat(localStorage.getItem("arc_panel_width") || "") || 45
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
        localStorage.setItem("arc_panel_width", String(panelWidthRef.current));
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

  // The preference lives on <html> so the whole page follows it at once.
  useEffect(() => {
    document.documentElement.dataset.font = fontPref;
  }, [fontPref]);

  useEffect(() => {
    if (hasToken()) {
      loadApp();
    } else {
      setScreen("welcome");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadApp = async () => {
    try {
      // Restore session ID from localStorage (if any) — but do NOT create a new one
      const sid = getStoredSessionId();
      const [data, me] = await Promise.all([getEntries(), getMe()]);

      setEntries(data || []);
      checkOnThisDay(data || []);
      setUsername(me.username);
      setChatCount(me.chatCount);
      setFreeLimit(me.freeLimit);
      setHasApiKey(me.hasApiKey);
      setIsOwner(me.isOwner);
      setPinLength(me.pinLength || 4);
      setCustomTags(me.customTags || []);
      setPersonaId(me.persona || "smriti");
      setCustomInstructions(me.customInstructions || "");
      // Absent on a server without migration 0008 — fall back to the defaults.
      setFontPref(me.fontPref ?? "reading");
      setLockOnClose(me.lockOnClose ?? true);
      setSessionId(sid || null);

      // Persona catalog for the picker + chat welcome (static, fetched once)
      getPersonas()
        .then((r) => setPersonas(r.personas))
        .catch(() => setPersonas([]));

      // If resuming a session, load its messages + pinned persona
      if (sid) {
        try {
          const msgs = await getChatMessages(sid);
          setChatMsgs(msgs.map((m) => ({ role: m.role, content: m.content })));
          getSessionMeta(sid)
            .then((meta) => setSessionPersonaId(meta.persona ?? null))
            .catch(() => setSessionPersonaId(null));
        } catch {
          // Session may have been deleted — start fresh
          setChatMsgs([]);
          clearSessionId();
          setSessionId(null);
        }
      }

      setScreen("app");

      // Native push registration (no-op on web). A notification tap deep-links
      // to its entry: open the journal and highlight the line.
      initPush((entryId) => {
        setDestination("journal");
        setHighlightEntryId(entryId);
        setTimeout(() => setHighlightEntryId(null), 4000);
      });
    } catch {
      clearToken();
      setScreen("login");
    }
  };

  const checkOnThisDay = (all: Entry[]) => {
    const now = new Date();
    setOnThisDay(
      all.filter((e) => {
        const d = new Date(e.created_at);
        return (
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate() &&
          d.getFullYear() < now.getFullYear()
        );
      })
    );
  };

  const handleSetup = async (u: string, pin: string, pLen?: number) => {
    await register(u, pin, pLen);
    // No session created here — lazy creation on first message
    await loadApp();
  };

  const handleLogin = async (u: string, pin: string) => {
    await login(u, pin);
    // No session created here — lazy creation on first message
    await loadApp();
  };

  const handleSaveEntry = async (text: string, activity: string, moodUser: number | null): Promise<boolean> => {
    setSaving(true);
    try {
      const entry = await createEntry(text, activity, moodUser);
      const updated = [entry, ...entries];
      setEntries(updated);
      checkOnThisDay(updated);
      // The entry is on the page now, so the writing view steps back.
      setWriting(false);
      return true;
    } catch (e) {
      showNotice(`Couldn't save this page — your words are still here. ${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateEntry = useCallback((id: string, moodData: EntryMood) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...moodData } : e))
    );
  }, []);

  // Delete flows through an in-app confirmation dialog (entryToDelete state)
  const requestDeleteEntry = (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry) setEntryToDelete(entry);
  };

  const confirmDeleteEntry = async () => {
    if (!entryToDelete) return;
    const id = entryToDelete.id;
    setEntryToDelete(null);
    try {
      await deleteEntry(id);
      const updated = entries.filter((e) => e.id !== id);
      setEntries(updated);
      checkOnThisDay(updated);
    } catch (e) {
      showNotice(`Couldn't tear out that page. ${(e as Error).message}`);
    }
  };

  const handleToggleFavorite = useCallback((id: string, isFavorite: boolean) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, is_favorite: isFavorite } : e)));
  }, []);

  // Persona switching is only offered before the first message of a chat
  // (see AiChat's pre-chat picker) — this handler just persists + reflects it.
  const handleSelectPersona = async (id: string) => {
    if (id === personaId) return;
    const previous = personaId;
    setPersonaId(id); // optimistic — instant welcome/suggestions swap
    try {
      await setPersonaApi(id);
    } catch (e) {
      setPersonaId(previous);
      showNotice(`Couldn't switch companion. ${(e as Error).message}`);
    }
  };

  const handleAddTag = async (tag: string) => {
    const result = await addTag(tag);
    setCustomTags(result.tags);
  };

  const handleRemoveTag = async (tag: string) => {
    const result = await removeTag(tag);
    setCustomTags(result.tags);
  };

  // ── Chat handlers ─────────────────────────────────────────────────────────

  const handleNewChat = () => {
    setChatMsgs([]);
    setSessionId(null);
    setSessionPersonaId(null);
    clearSessionId();
  };

  const handleResumeSession = async (session: ChatSession) => {
    try {
      const messages = await getChatMessages(session.id);
      setChatMsgs(messages.map((m) => ({ role: m.role, content: m.content })));
      setSessionId(session.id);
      setSessionPersonaId(session.persona ?? null);
      storeSessionId(session.id);
      setShowChats(false);
    } catch {
      showNotice("Couldn't open that conversation — try again in a moment.");
    }
  };

  // ── Export / Lock / Sign Out ───────────────────────────────────────────────

  const handleExport = () => {
    const lines = entries
      .map((e) => {
        const act = e.activity ? `\nContext: ${e.activity}` : "";
        const moodAi = e.mood ? `\nAI Mood: ${e.mood_label} (${e.mood}/10)` : "";
        const moodU = e.mood_user ? `\nYour Mood: ${e.mood_user_label} (${e.mood_user}/10)` : "";
        return `[${new Date(e.created_at).toLocaleString()}]${act}${moodU}${moodAi}\n${e.text}`;
      })
      .join("\n\n---\n\n");
    const blob = new Blob(
      [`MY INNER ARCHIVE\nExported: ${new Date().toLocaleString()}\nEntries: ${entries.length}\n\n${"═".repeat(40)}\n\n${lines}`],
      { type: "text/plain" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-inner-archive.txt";
    a.click();
  };

  const handleLock = () => {
    clearToken();
    clearSessionId();
    setEntries([]);
    setChatMsgs([]);
    setSessionId(null);
    setSessionPersonaId(null);
    setScreen("login");
  };

  const handleSignOut = () => {
    clearToken();
    clearSessionId();
    localStorage.removeItem("arc_username");
    setEntries([]);
    setChatMsgs([]);
    setSessionId(null);
    setSessionPersonaId(null);
    setShowProfile(false);
    setScreen("welcome");
  };

  // ── Screens ──────────────────────────────────────────────────────────────

  if (screen === "loading") {
    return <div className="center-screen"><span className="loading-text loading-pulse">Loading...</span></div>;
  }

  if (screen === "welcome") {
    return (
      <div className="welcome-screen">
        <div className="welcome-card">
          <div className="welcome-icon">🌱</div>
          <div className="welcome-title">My Inner Archive</div>
          <div className="welcome-desc">
            A private space to capture your thoughts and let AI reflect your own wisdom back to you.
          </div>
          <div className="welcome-features">
            {FEATURES.map(([icon, title, desc]) => (
              <div key={title} className="welcome-feature">
                <div className="welcome-feature-icon">{icon}</div>
                <div>
                  <div className="welcome-feature-title">{title}</div>
                  <div className="welcome-feature-desc">{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="welcome-cta" onClick={() => setScreen("setup")}>Get Started →</button>
          <div className="pin-footnote">
            <button className="pin-footnote-link" onClick={() => setScreen("login")}>
              already have one? log in
            </button>
          </div>
          <div className="welcome-footer">yours alone, kept private</div>
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    return <PinPad mode="setup" onSuccess={handleSetup} onBack={() => setScreen("login")} error={authError} />;
  }
  if (screen === "login") return <PinPad mode="login" onSuccess={handleLogin} error={authError} />;

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderJournal = (layout: Layout) => (
    <>
      {writing ? (
        <>
          <div className="writing-head">
            <span className="writing-head-date">{formatDayHeading(new Date().toISOString())}</span>
            <button className="writing-head-leave" onClick={() => setWriting(false)}>
              not now
            </button>
          </div>
          <EntryForm
            ref={layout === "phone" ? phoneFormRef : deskFormRef}
            onSave={handleSaveEntry}
            saving={saving}
            customTags={customTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            canUseOcr={isOwner || hasApiKey}
          />
        </>
      ) : (
        onThisDay.length > 0 && (
          <button className="otd-prompt" onClick={() => setShowOTD(true)}>
            you wrote on this day before — {onThisDay.length}{" "}
            {onThisDay.length === 1 ? "entry" : "entries"}
          </button>
        )
      )}
      <EntryList
        entries={entries}
        onDelete={requestDeleteEntry}
        onUpdateEntry={handleUpdateEntry}
        onToggleFavorite={handleToggleFavorite}
        highlightId={highlightEntryId}
      />
    </>
  );

  const handleScrollToEntry = (id: string) => {
    setDestination("journal");
    setHighlightEntryId(id);
    setTimeout(() => {
      document.getElementById(`entry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  };

  // Opening a day from the heatmap jumps to its first entry in the journal.
  const renderInsights = () => (
    <Patterns
      onOpenDay={(date) => {
        const match = entries.find((e) => dayKey(e.created_at) === dayKey(`${date}T12:00:00`));
        if (match) handleScrollToEntry(match.id);
        else setDestination("journal");
      }}
    />
  );

  // The resumed session's pinned persona wins; new chats use the user's pick
  const activePersona = personas.find((p) => p.id === (sessionPersonaId ?? personaId)) ?? null;

  const renderChat = () => (
    <AiChat
      sessionId={sessionId}
      setSessionId={setSessionId}
      msgs={chatMsgs}
      setMsgs={setChatMsgs}
      onNewChat={handleNewChat}
      chatCount={chatCount}
      freeLimit={freeLimit}
      hasApiKey={hasApiKey}
      isOwner={isOwner}
      persona={activePersona}
      personas={personas}
      onSelectPersona={handleSelectPersona}
      onSessionCreated={setSessionPersonaId}
      onOpenNav={() => setNavOpen(true)}
        onOpenHistory={() => setShowChats(true)}
    />
  );

  /** Optimistic: the page changes at once, and reverts if the save fails. */
  const handleFontPref = async (next: FontPref) => {
    const previous = fontPref;
    setFontPref(next);
    setPrefError("");
    try {
      await setPreferences({ fontPref: next });
    } catch {
      setFontPref(previous);
      setPrefError("couldn't save that — it's back how it was");
    }
  };

  const handleLockOnClose = async (next: boolean) => {
    const previous = lockOnClose;
    setLockOnClose(next);
    setPrefError("");
    try {
      await setPreferences({ lockOnClose: next });
    } catch {
      setLockOnClose(previous);
      setPrefError("couldn't save that — it's back how it was");
    }
  };

  // Settings is a destination, but it is still the existing profile sheet;
  // leaving it returns you to the journal.
  const closeSettings = () => {
    setShowProfile(false);
    setPrefError("");
    if (destination === "settings") setDestination("journal");
  };

  const go = (d: Destination) => {
    setDestination(d);
    if (d === "settings") setShowProfile(true);
  };

  /** On a wide page the chat has its own panel, so the left one never shows it. */
  const panelDestination: Destination = destination === "chat" ? "journal" : destination;

  const renderDestination = (d: Destination, layout: Layout) => {
    if (d === "chat") return renderChat();
    if (d === "patterns") return renderInsights();
    return renderJournal(layout);
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
        onLock={handleLock}
      />

      {/* Desktop split layout */}
      <div
        className="split-layout desktop-only"
        ref={splitRef}
        style={{ display: "flex", overflow: "hidden" }}
      >
        <div className="panel-left" style={{ flex: `0 0 ${panelWidth}%`, width: `${panelWidth}%` }}>
          {renderDestination(panelDestination, "desktop")}
        </div>

        <div
          className="panel-resizer"
          onMouseDown={(e) => {
            e.preventDefault();
            isDragging.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        {renderChat()}
      </div>

      {/* Narrow page: one destination at a time */}
      <div className="mobile-content mobile-only">
        {renderDestination(destination, "phone")}
      </div>

      {navOpen && (
        <PageNav current={destination} onGo={go} onClose={() => setNavOpen(false)} />
      )}

      {destination !== "chat" && (
      <ActionBar
        menuOpen={navOpen}
        onMenu={() => setNavOpen((v) => !v)}
        onWrite={() => {
          setDestination("journal");
          setWriting(true);
          setTimeout(() => visibleForm()?.focus(), 60);
        }}
        onVoice={() => {
          setDestination("journal");
          setWriting(true);
          setVoiceActive((v) => !v);
          setTimeout(() => {
            visibleForm()?.focus();
            visibleForm()?.toggleDictation();
          }, 60);
        }}
        onPhoto={() => {
          setDestination("journal");
          setWriting(true);
          setTimeout(() => {
            visibleForm()?.focus();
            visibleForm()?.openCamera();
          }, 60);
        }}
        voiceAvailable={hasWebSpeech()}
        voiceActive={voiceActive}
      />
      )}

      {showOTD && <OnThisDayModal entries={onThisDay} onClose={() => setShowOTD(false)} />}
      {showChats && (
        <ChatHistoryDrawer
          currentSessionId={sessionId}
          onClose={() => setShowChats(false)}
          onResumeSession={handleResumeSession}
          personas={personas}
        />
      )}
      {showProfile && (
        <ProfileModal
          username={username}
          pinLength={pinLength}
          onClose={closeSettings}
          onSignOut={handleSignOut}
          canUseOcr={isOwner || hasApiKey}
          onOpenBulkImport={() => { setShowProfile(false); setShowBulkImport(true); }}
          personas={personas}
          personaId={personaId}
          onPersonaChange={setPersonaId}
          customInstructions={customInstructions}
          onInstructionsChange={setCustomInstructions}
          personaLocked={chatMsgs.length > 0}
          onExport={handleExport}
          onLock={handleLock}
          fontPref={fontPref}
          onFontPrefChange={handleFontPref}
          lockOnClose={lockOnClose}
          onLockOnCloseChange={handleLockOnClose}
          prefError={prefError}
        />
      )}
      {entryToDelete && (
        <ConfirmDialog
          title="Tear out this page?"
          message="It will be gone from your archive for good. This can't be undone."
          excerpt={entryToDelete.text}
          confirmLabel="tear it out"
          danger
          onConfirm={confirmDeleteEntry}
          onCancel={() => setEntryToDelete(null)}
        />
      )}
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onImported={async () => {
            try {
              const data = await getEntries();
              setEntries(data || []);
              checkOnThisDay(data || []);
            } catch { /* list refreshes on next load */ }
          }}
        />
      )}
      {notice && <Notice notice={notice} onDismiss={dismissNotice} />}
    </div>
  );
}
