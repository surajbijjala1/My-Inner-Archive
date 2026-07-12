import { useState, useEffect, useRef, useCallback } from "react";
import {
  hasToken, clearToken,
  getEntries, createEntry, deleteEntry,
  register, login, getMe,
  getChatMessages,
  addTag, removeTag,
  getStoredSessionId, storeSessionId, clearSessionId,
  getPersonas, setPersona as setPersonaApi,
} from "./api";
import type { ChatMessage, ChatSession, Entry, EntryMood, PersonaMeta } from "./types";

import PinPad from "./components/PinPad";
import Header from "./components/Header";
import EntryForm from "./components/EntryForm";
import EntryList from "./components/EntryList";
import MoodGraph from "./components/MoodGraph";
import AiChat from "./components/AiChat";
import OnThisDayModal from "./components/OnThisDayModal";
import ChatHistoryDrawer from "./components/ChatHistoryDrawer";
import ProfileModal from "./components/ProfileModal";
import BulkImportModal from "./components/BulkImportModal";
import ConfirmDialog from "./components/ConfirmDialog";
import { initPush } from "./push";

type Screen = "loading" | "welcome" | "setup" | "login" | "app";

const FEATURES: [string, string, string][] = [
  ["📝", "Capture thoughts", "Write anything, any time. Timestamped and private."],
  ["🏷️", "Tag your context", "Record where you were when the insight hit."],
  ["📈", "Mood timeline", "See your emotional patterns over time, automatically."],
  ["🤖", "AI from your words", "Your archive answers with only your own words."],
  ["📅", "On This Day", "See what you wrote on this date in past years."],
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeTab, setActiveTab] = useState<"journal" | "mood">("journal");
  const [mobileTab, setMobileTab] = useState<"journal" | "insights" | "chat">("journal");
  const [onThisDay, setOnThisDay] = useState<Entry[]>([]);
  const [showOTD, setShowOTD] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<Entry | null>(null);
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

  // Chat state — lifted here so it survives mobile tab switches
  const [sessionId, setSessionId] = useState<string | null>(null);
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
      setSessionId(sid || null);

      // Persona catalog for the picker + chat welcome (static, fetched once)
      getPersonas()
        .then((r) => setPersonas(r.personas))
        .catch(() => setPersonas([]));

      // If resuming a session, load its messages
      if (sid) {
        try {
          const msgs = await getChatMessages(sid);
          setChatMsgs(msgs.map((m) => ({ role: m.role, content: m.content })));
        } catch {
          // Session may have been deleted — start fresh
          setChatMsgs([]);
          clearSessionId();
          setSessionId(null);
        }
      }

      setScreen("app");

      // Native push registration (no-op on web). A notification tap deep-links
      // to its entry: switch to the journal tab and highlight the card.
      initPush((entryId) => {
        setMobileTab("journal");
        setActiveTab("journal");
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

  const handleSaveEntry = async (text: string, activity: string, moodUser: number | null) => {
    setSaving(true);
    try {
      const entry = await createEntry(text, activity, moodUser);
      const updated = [entry, ...entries];
      setEntries(updated);
      checkOnThisDay(updated);
    } catch (e) {
      alert("Failed to save: " + (e as Error).message);
    }
    setSaving(false);
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
      alert("Failed to delete: " + (e as Error).message);
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
      alert("Failed to switch companion: " + (e as Error).message);
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
    clearSessionId();
  };

  const handleResumeSession = async (session: ChatSession) => {
    try {
      const messages = await getChatMessages(session.id);
      setChatMsgs(messages.map((m) => ({ role: m.role, content: m.content })));
      setSessionId(session.id);
      storeSessionId(session.id);
      setShowChats(false);
    } catch {
      alert("Failed to load session");
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
    setScreen("login");
  };

  const handleSignOut = () => {
    clearToken();
    clearSessionId();
    localStorage.removeItem("arc_username");
    setEntries([]);
    setChatMsgs([]);
    setSessionId(null);
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
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setScreen("login")}
              style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "13px", fontFamily: "inherit" }}
            >
              Already have an account? <strong style={{ color: "#1a1a1a" }}>Log in</strong>
            </button>
          </div>
          <div className="welcome-footer">Your thoughts are private and stored securely.</div>
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    return <PinPad mode="setup" onSuccess={handleSetup} onBack={() => setScreen("login")} error={authError} />;
  }
  if (screen === "login") return <PinPad mode="login" onSuccess={handleLogin} error={authError} />;

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderJournal = () => (
    <>
      <EntryForm
        onSave={handleSaveEntry}
        saving={saving}
        customTags={customTags}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
        canUseOcr={isOwner || hasApiKey}
      />
      <hr className="divider" />
      <EntryList
        entries={entries}
        onDelete={requestDeleteEntry}
        onUpdateEntry={handleUpdateEntry}
        onToggleFavorite={handleToggleFavorite}
        highlightId={highlightEntryId}
      />
    </>
  );

  const renderInsights = () => <MoodGraph entries={entries} />;

  const activePersona = personas.find((p) => p.id === personaId) ?? null;

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
    />
  );

  // ── Main App ──────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <Header
        onThisDayCount={onThisDay.length}
        onShowOTD={() => setShowOTD(true)}
        onExport={handleExport}
        onLock={handleLock}
        onShowChats={() => setShowChats(true)}
        onShowProfile={() => setShowProfile(true)}
      />

      {/* Desktop tabs */}
      <div className="tabs desktop-only">
        {(["journal", "mood"] as const).map((t) => (
          <button
            key={t}
            className={`tab ${activeTab === t ? "tab--active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t === "journal" ? "📝 Journal" : "📈 Mood Timeline"}
          </button>
        ))}
      </div>

      {/* Desktop split layout */}
      <div
        className="split-layout desktop-only"
        ref={splitRef}
        style={{ display: "flex", overflow: "hidden" }}
      >
        <div className="panel-left" style={{ flex: `0 0 ${panelWidth}%`, width: `${panelWidth}%` }}>
          {activeTab === "journal" && renderJournal()}
          {activeTab === "mood" && renderInsights()}
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

      {/* Mobile content area */}
      <div className="mobile-content mobile-only">
        {mobileTab === "journal" && renderJournal()}
        {mobileTab === "insights" && renderInsights()}
        {mobileTab === "chat" && renderChat()}
      </div>

      {/* Mobile bottom navigation */}
      <div className="mobile-nav mobile-only">
        {([
          { id: "journal", icon: "📝", label: "Journal" },
          { id: "insights", icon: "📈", label: "Insights" },
          { id: "chat", icon: "💬", label: "Chat" },
        ] as const).map((t) => (
          <button
            key={t.id}
            className={`mobile-nav-btn ${mobileTab === t.id ? "mobile-nav-btn--active" : ""}`}
            onClick={() => setMobileTab(t.id)}
          >
            <span>{t.icon}</span>
            <span className="mobile-nav-label">{t.label}</span>
          </button>
        ))}
      </div>

      {showOTD && <OnThisDayModal entries={onThisDay} onClose={() => setShowOTD(false)} />}
      {showChats && (
        <ChatHistoryDrawer
          currentSessionId={sessionId}
          onClose={() => setShowChats(false)}
          onResumeSession={handleResumeSession}
        />
      )}
      {showProfile && (
        <ProfileModal
          username={username}
          pinLength={pinLength}
          onClose={() => setShowProfile(false)}
          onSignOut={handleSignOut}
          canUseOcr={isOwner || hasApiKey}
          onOpenBulkImport={() => { setShowProfile(false); setShowBulkImport(true); }}
          personas={personas}
          personaId={personaId}
          onPersonaChange={setPersonaId}
          customInstructions={customInstructions}
          onInstructionsChange={setCustomInstructions}
          personaLocked={chatMsgs.length > 0}
        />
      )}
      {entryToDelete && (
        <ConfirmDialog
          title="🗑 Delete this entry?"
          message="It will be removed from your archive permanently. This can't be undone."
          excerpt={entryToDelete.text}
          confirmLabel="Delete"
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
    </div>
  );
}
