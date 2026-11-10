import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import { PERSONAS, DEFAULT_PERSONA_ID, personaCatalog } from "../prompts/personas.js";
import type { AuthedRequest } from "../types.js";
import { KeyStorageUnavailableError, openApiKey, sealApiKey } from "../lib/secret-box.js";

const router = Router();
const MAX_INSTRUCTIONS_LENGTH = 500;

/** How entries are set. Mirrors the users_font_pref_check constraint (0008). */
const FONT_PREFS: readonly string[] = ["reading", "handwritten", "plain"];
const DEFAULT_FONT_PREF = "reading";

// GET /user/me — full user profile
router.get("/me", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;
    const isOwner = username === config.ownerUsername;

    const COLUMNS =
      "chat_count, user_api_key, pin_length, custom_tags, persona, custom_instructions";

    // font_pref / lock_on_close may not exist yet (migration 0008). Selecting a
    // missing column fails the whole query, so fall back to the older shape
    // rather than blocking the profile — the same guard the persona columns use.
    let record: Record<string, any> | null = null;
    const full = await supabase
      .from("users")
      .select(`${COLUMNS}, font_pref, lock_on_close`)
      .eq("username", username)
      .single();

    if (full.error || !full.data) {
      const legacy = await supabase
        .from("users")
        .select(COLUMNS)
        .eq("username", username)
        .single();
      if (legacy.error || !legacy.data) {
        return res.status(404).json({ error: "User not found" });
      }
      record = legacy.data;
    } else {
      record = full.data;
    }

    const chatCount: number = record.chat_count || 0;
    // Usable, not merely present: an undecryptable key would otherwise show as
    // active while chat silently falls back to the trial key.
    const hasApiKey = openApiKey(record.user_api_key, username) !== null;
    const pinLength: number = record.pin_length || 4;
    const customTags: string[] = record.custom_tags || [];
    const persona: string = PERSONAS[record.persona] ? record.persona : DEFAULT_PERSONA_ID;

    return res.json({
      username,
      isOwner,
      chatCount,
      freeLimit: config.freeMessageLimit,
      hasApiKey,
      pinLength,
      customTags,
      persona,
      customInstructions: record.custom_instructions || "",
      fontPref: FONT_PREFS.includes(record.font_pref) ? record.font_pref : DEFAULT_FONT_PREF,
      lockOnClose: record.lock_on_close ?? true,
      freeRemaining: isOwner || hasApiKey ? null : Math.max(0, config.freeMessageLimit - chatCount),
    });
  } catch (e) {
    console.error("[ERROR] GetMe |", (e as Error).message);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// POST /user/api-key — save own Gemini API key
router.post("/api-key", auth, async (req: AuthedRequest, res) => {
  try {
    const { apiKey } = req.body as { apiKey?: string };
    const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!trimmed) return res.status(400).json({ error: "API key is required" });
    if (trimmed.length > 200) return res.status(400).json({ error: "That doesn't look like an API key" });

    const username = req.user!.username;
    let sealed: string;
    try {
      sealed = sealApiKey(trimmed, username);
    } catch (e) {
      if (e instanceof KeyStorageUnavailableError) {
        console.error("[ERROR] SaveApiKey | refusing: API_KEY_ENCRYPTION_KEY unset");
        return res.status(503).json({ error: "Saving API keys isn't available right now" });
      }
      throw e;
    }

    const { error } = await supabase
      .from("users")
      .update({ user_api_key: sealed })
      .eq("username", username);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] SaveApiKey |", (e as Error).message);
    res.status(500).json({ error: "Failed to save API key" });
  }
});

// GET /user/personas — public persona catalog for the picker (auth'd, static)
router.get("/personas", auth, (_req: AuthedRequest, res) => {
  res.json({ personas: personaCatalog(), defaultPersona: DEFAULT_PERSONA_ID });
});

// POST /user/persona — select the active companion persona
router.post("/persona", auth, async (req: AuthedRequest, res) => {
  try {
    const { persona } = req.body as { persona?: string };
    if (!persona || !PERSONAS[persona]) {
      return res.status(400).json({ error: "Unknown persona" });
    }

    const { error } = await supabase
      .from("users")
      .update({ persona })
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, persona });
  } catch (e) {
    console.error("[ERROR] SetPersona |", (e as Error).message);
    res.status(500).json({ error: "Failed to set persona" });
  }
});

// POST /user/instructions — save custom "how to talk to me" instructions
router.post("/instructions", auth, async (req: AuthedRequest, res) => {
  try {
    const { instructions } = req.body as { instructions?: string };
    const trimmed = (instructions ?? "").trim();
    if (trimmed.length > MAX_INSTRUCTIONS_LENGTH) {
      return res.status(400).json({ error: `Instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or less` });
    }

    const { error } = await supabase
      .from("users")
      .update({ custom_instructions: trimmed || null })
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] SetInstructions |", (e as Error).message);
    res.status(500).json({ error: "Failed to save instructions" });
  }
});

// POST /user/preferences — how the archive reads, and whether it re-locks.
// Both fields are optional; only what is sent is changed.
router.post("/preferences", auth, async (req: AuthedRequest, res) => {
  try {
    const { fontPref, lockOnClose } = req.body as {
      fontPref?: string;
      lockOnClose?: boolean;
    };

    const patch: Record<string, unknown> = {};
    if (fontPref !== undefined) {
      if (!FONT_PREFS.includes(fontPref)) {
        return res.status(400).json({ error: "Unknown font preference" });
      }
      patch.font_pref = fontPref;
    }
    if (lockOnClose !== undefined) {
      if (typeof lockOnClose !== "boolean") {
        return res.status(400).json({ error: "lockOnClose must be a boolean" });
      }
      patch.lock_on_close = lockOnClose;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const { error } = await supabase
      .from("users")
      .update(patch)
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, ...req.body });
  } catch (e) {
    console.error("[ERROR] SetPreferences |", (e as Error).message);
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

// GET /user/tags — get custom tags
router.get("/tags", auth, async (req: AuthedRequest, res) => {
  try {
    const { data } = await supabase
      .from("users")
      .select("custom_tags")
      .eq("username", req.user!.username)
      .single();

    res.json({ tags: data?.custom_tags || [] });
  } catch (e) {
    console.error("[ERROR] GetTags |", (e as Error).message);
    res.status(500).json({ error: "Failed to load tags" });
  }
});

// POST /user/tags — add a custom tag
router.post("/tags", auth, async (req: AuthedRequest, res) => {
  try {
    const { tag } = req.body as { tag?: string };
    if (!tag?.trim()) return res.status(400).json({ error: "Tag is required" });
    if (tag.trim().length > 30) return res.status(400).json({ error: "Tag must be 30 chars or less" });

    const { data } = await supabase
      .from("users")
      .select("custom_tags")
      .eq("username", req.user!.username)
      .single();

    const existing: string[] = data?.custom_tags || [];
    if (existing.length >= 20) return res.status(400).json({ error: "Maximum 20 custom tags" });
    if (existing.includes(tag.trim())) return res.status(400).json({ error: "Tag already exists" });

    const updated = [...existing, tag.trim()];
    const { error } = await supabase
      .from("users")
      .update({ custom_tags: updated })
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ tags: updated });
  } catch (e) {
    console.error("[ERROR] AddTag |", (e as Error).message);
    res.status(500).json({ error: "Failed to add tag" });
  }
});

// DELETE /user/tags/:tag — remove a custom tag
router.delete("/tags/:tag", auth, async (req: AuthedRequest, res) => {
  try {
    const rawTag = req.params.tag;
    const tagToRemove = decodeURIComponent(Array.isArray(rawTag) ? rawTag[0] : rawTag);

    const { data } = await supabase
      .from("users")
      .select("custom_tags")
      .eq("username", req.user!.username)
      .single();

    const updated = ((data?.custom_tags as string[] | null) || []).filter((t) => t !== tagToRemove);
    const { error } = await supabase
      .from("users")
      .update({ custom_tags: updated })
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ tags: updated });
  } catch (e) {
    console.error("[ERROR] RemoveTag |", (e as Error).message);
    res.status(500).json({ error: "Failed to remove tag" });
  }
});

export default router;
