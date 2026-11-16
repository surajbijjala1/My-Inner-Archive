import { useCallback, useEffect, useState } from "react";
import {
  addTag, removeTag, getPersonas, setPersona as setPersonaApi, setPreferences,
} from "../api";
import type { FontPref, PersonaMeta, UserProfile } from "../types";

/**
 * Who is signed in and what they have chosen: account facts, tags, the
 * companion, and the reading preferences.
 */
export function useProfile(showNotice: (text: string) => void) {
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

  // The preference lives on <html> so the whole page follows it at once.
  useEffect(() => {
    document.documentElement.dataset.font = fontPref;
  }, [fontPref]);

  /** Take in the signed-in user's profile from GET /user/me. */
  const applyMe = useCallback((me: UserProfile) => {
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
  }, []);

  const loadPersonas = useCallback(() => {
    getPersonas()
      .then((r) => setPersonas(r.personas))
      .catch(() => setPersonas([]));
  }, []);

  // Persona switching is only offered before the first message of a chat
  // (see AiChat's pre-chat picker) — this handler just persists + reflects it.
  const selectPersona = async (id: string) => {
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

  const addCustomTag = async (tag: string) => {
    const result = await addTag(tag);
    setCustomTags(result.tags);
  };

  const removeCustomTag = async (tag: string) => {
    const result = await removeTag(tag);
    setCustomTags(result.tags);
  };

  /** Optimistic: the page changes at once, and reverts if the save fails. */
  const changeFontPref = async (next: FontPref) => {
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

  const changeLockOnClose = async (next: boolean) => {
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

  return {
    username, chatCount, freeLimit, hasApiKey, isOwner, pinLength, customTags,
    personaId, setPersonaId, customInstructions, setCustomInstructions, personas,
    fontPref, lockOnClose, prefError, setPrefError,
    /** OCR is open to the owner and to anyone using their own API key. */
    canUseOcr: isOwner || hasApiKey,
    applyMe, loadPersonas, selectPersona, addCustomTag, removeCustomTag,
    changeFontPref, changeLockOnClose,
  };
}

export type Profile = ReturnType<typeof useProfile>;
