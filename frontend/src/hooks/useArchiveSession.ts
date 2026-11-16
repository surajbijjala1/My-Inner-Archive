import { useCallback, useEffect, useState } from "react";
import {
  ApiError, clearSessionId, clearToken, forgetUsername, getEntries, getMe,
  getStoredSessionId, hasToken, login, register, setSessionExpiredHandler,
} from "../api";
import { clearDraft, hasDraft } from "../draft";
import { initPush } from "../push";
import type { Destination } from "../types";
import type { Chat } from "./useChat";
import type { Journal } from "./useJournal";
import type { Overlays } from "./useOverlays";
import type { Profile } from "./useProfile";

// "unreachable": signed in, but the archive didn't answer — retry, don't sign out.
export type Screen = "loading" | "welcome" | "setup" | "login" | "unreachable" | "app";

interface SessionDeps {
  journal: Pick<Journal, "replaceEntries" | "clearEntries" | "setWriting" | "cancelDelete" | "setHighlightEntryId">;
  chat: Pick<Chat, "setSessionId" | "reset" | "restoreStored">;
  profile: Pick<Profile, "applyMe" | "loadPersonas">;
  overlays: Pick<Overlays, "closeAll" | "setShowProfile">;
  setDestination: (d: Destination) => void;
}

/**
 * Which screen is showing, and the moves between them: launching, signing up
 * or in, locking, signing out, and a session that expired on its own.
 * Every dependency it takes is stable, so its callbacks are too.
 */
export function useArchiveSession({ journal, chat, profile, overlays, setDestination }: SessionDeps) {
  const [screen, setScreen] = useState<Screen>("loading");
  // Why the sign-in page is showing when the user didn't ask for it.
  const [authError, setAuthError] = useState("");

  const { replaceEntries, clearEntries, setWriting, cancelDelete, setHighlightEntryId } = journal;
  const { setSessionId, reset: resetChat, restoreStored } = chat;
  const { applyMe, loadPersonas } = profile;
  const { closeAll, setShowProfile } = overlays;

  const loadApp = useCallback(async () => {
    try {
      // Restore session ID from localStorage (if any) — but do NOT create a new one
      const sid = getStoredSessionId();
      const [data, me] = await Promise.all([getEntries(), getMe()]);

      replaceEntries(data || []);
      applyMe(me);
      setSessionId(sid || null);

      // A draft that outlived a crash, a reload or an expired session: open
      // the writing view on it rather than leaving it to be stumbled upon.
      if (hasDraft(me.username)) setWriting(true);

      // Persona catalog for the picker + chat welcome (static; the companion
      // sheet can ask again if this fails)
      loadPersonas();

      // If resuming a session, load its messages + pinned persona
      if (sid) await restoreStored(sid);

      setAuthError("");
      setScreen("app");

      // Native push registration (no-op on web). A notification tap deep-links
      // to its entry: open the journal and highlight the line.
      initPush((entryId) => {
        setDestination("journal");
        setHighlightEntryId(entryId);
        setTimeout(() => setHighlightEntryId(null), 4000);
      });
    } catch (e) {
      // 401 has already been handled (signed out, sign-in page showing).
      if (e instanceof ApiError && e.status === 401) return;
      // Anything else — offline, server asleep, a 5xx — says nothing about
      // the token. Signing the user out for it would be wrong; offer a retry.
      setScreen("unreachable");
    }
  }, [replaceEntries, applyMe, setSessionId, setWriting, loadPersonas, restoreStored, setDestination, setHighlightEntryId]);

  useEffect(() => {
    if (hasToken()) {
      loadApp();
    } else {
      setScreen("welcome");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An expired or revoked token can surface on any request, from any screen.
  // Whichever one hits it first lands here: back to the sign-in page, saying
  // why. The unsent draft is deliberately kept — it is tagged with its owner
  // and comes back when that same person signs in again.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearToken();
      clearEntries();
      resetChat();
      closeAll();
      cancelDelete();
      setAuthError("You've been signed out — sign in again to carry on.");
      setScreen("login");
    });
    return () => setSessionExpiredHandler(null);
  }, [clearEntries, resetChat, closeAll, cancelDelete]);

  const retryLoad = () => {
    setScreen("loading");
    void loadApp();
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

  const handleLock = () => {
    clearToken();
    clearSessionId();
    clearDraft(); // locking leaves no journal text on the device
    setWriting(false);
    setAuthError("");
    clearEntries();
    resetChat();
    setScreen("login");
  };

  const handleSignOut = () => {
    clearToken();
    clearSessionId();
    clearDraft();
    setWriting(false);
    setAuthError("");
    forgetUsername();
    clearEntries();
    resetChat();
    setShowProfile(false);
    setScreen("welcome");
  };

  return {
    screen, setScreen, authError,
    retryLoad, handleSetup, handleLogin, handleLock, handleSignOut,
  };
}
