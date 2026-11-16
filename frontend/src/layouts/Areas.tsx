import type { RefObject } from "react";
import AiChat from "../components/AiChat";
import EntryForm, { type EntryFormHandle } from "../components/EntryForm";
import EntryList from "../components/EntryList";
import ErrorBoundary from "../components/ErrorBoundary";
import Patterns from "../components/Patterns";
import type { Chat } from "../hooks/useChat";
import type { Journal } from "../hooks/useJournal";
import type { Profile } from "../hooks/useProfile";
import type { Destination } from "../types";
import { formatDayHeading } from "../utils";
import type { CrashFallbacks } from "./crashFallbacks";
import type { Layout } from "./layout";

/** Everything the three areas need. Built once in App and handed to both layouts. */
export interface AreaProps {
  journal: Journal;
  profile: Profile;
  chat: Chat;
  fallbacks: CrashFallbacks;
  /** One form ref per copy of the journal, so the action bar drives the visible one. */
  formRefs: Record<Layout, RefObject<EntryFormHandle | null>>;
  onDictatingChange: (active: boolean) => void;
  onOpenOnThisDay: () => void;
  /** Opening a day from the heatmap. `date` is YYYY-MM-DD. */
  onOpenDay: (date: string) => void;
  onOpenNav: () => void;
  onOpenHistory: () => void;
}

/** The journal: the writing view (or the on-this-day prompt) above the entries. */
function JournalView({ layout, journal, profile, formRefs, onDictatingChange, onOpenOnThisDay }: AreaProps & { layout: Layout }) {
  return (
    <>
      {journal.writing ? (
        <>
          <div className="writing-head">
            <span className="writing-head-date">{formatDayHeading(new Date().toISOString())}</span>
            <button className="writing-head-leave" onClick={journal.leaveWriting}>
              not now
            </button>
          </div>
          <EntryForm
            ref={formRefs[layout]}
            onDictatingChange={onDictatingChange}
            onSave={journal.saveEntry}
            saving={journal.saving}
            customTags={profile.customTags}
            onAddTag={profile.addCustomTag}
            onRemoveTag={profile.removeCustomTag}
            canUseOcr={profile.canUseOcr}
            draftOwner={profile.username}
          />
        </>
      ) : (
        journal.onThisDay.length > 0 && (
          <button className="otd-prompt" onClick={onOpenOnThisDay}>
            you wrote on this day before — {journal.onThisDay.length}{" "}
            {journal.onThisDay.length === 1 ? "entry" : "entries"}
          </button>
        )
      )}
      <EntryList
        entries={journal.entries}
        onDelete={journal.requestDelete}
        onUpdateEntry={journal.updateEntryMood}
        onToggleFavorite={journal.toggleFavorite}
        highlightId={journal.highlightEntryId}
      />
    </>
  );
}

/**
 * The chat area, behind its own error boundary. Keyed by layout so each copy
 * keeps its own error.
 */
export function ChatArea({ layout, chat, profile, fallbacks, onOpenNav, onOpenHistory }: AreaProps & { layout: Layout }) {
  // The resumed session's pinned persona wins; new chats use the user's pick
  const activePersona =
    profile.personas.find((p) => p.id === (chat.sessionPersonaId ?? profile.personaId)) ?? null;

  return (
    <ErrorBoundary key={`${layout}-chat`} area="chat" fallback={fallbacks.chat}>
      <AiChat
        sessionId={chat.sessionId}
        setSessionId={chat.setSessionId}
        msgs={chat.chatMsgs}
        setMsgs={chat.setChatMsgs}
        onNewChat={chat.newChat}
        chatCount={profile.chatCount}
        freeLimit={profile.freeLimit}
        hasApiKey={profile.hasApiKey}
        isOwner={profile.isOwner}
        persona={activePersona}
        personas={profile.personas}
        onSelectPersona={profile.selectPersona}
        onSessionCreated={chat.setSessionPersonaId}
        onOpenNav={onOpenNav}
        onOpenHistory={onOpenHistory}
      />
    </ErrorBoundary>
  );
}

/**
 * One destination, behind its own error boundary. Keyed by layout +
 * destination: going somewhere else leaves a crashed area's error behind
 * instead of carrying it along. ("settings" is a sheet over the journal.)
 */
export function DestinationView(props: AreaProps & { destination: Destination; layout: Layout }) {
  const { destination, layout, fallbacks, onOpenDay } = props;
  if (destination === "chat") return <ChatArea {...props} />;
  if (destination === "patterns") {
    return (
      <ErrorBoundary key={`${layout}-patterns`} area="patterns" fallback={fallbacks.patterns}>
        <Patterns onOpenDay={onOpenDay} />
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary key={`${layout}-journal`} area="journal" fallback={fallbacks.journal}>
      <JournalView {...props} />
    </ErrorBoundary>
  );
}
