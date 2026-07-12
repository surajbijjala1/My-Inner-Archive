import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import { PERSONAS, DEFAULT_PERSONA_ID, personaCatalog } from "../prompts/personas.js";
import type { AuthedRequest } from "../types.js";

const router = Router();
const MAX_INSTRUCTIONS_LENGTH = 500;

// GET /user/me — full user profile
router.get("/me", auth, async (req: AuthedRequest, res) => {
  try {
    const username = req.user!.username;
    const isOwner = username === config.ownerUsername;

    const { data: userRecord, error } = await supabase
      .from("users")
      .select("chat_count, user_api_key, pin_length, custom_tags, persona, custom_instructions")
      .eq("username", username)
      .single();

    if (error || !userRecord) return res.status(404).json({ error: "User not found" });

    const chatCount: number = userRecord.chat_count || 0;
    const hasApiKey = !!userRecord.user_api_key;
    const pinLength: number = userRecord.pin_length || 4;
    const customTags: string[] = userRecord.custom_tags || [];
    const persona: string = PERSONAS[userRecord.persona] ? userRecord.persona : DEFAULT_PERSONA_ID;

    return res.json({
      username,
      isOwner,
      chatCount,
      freeLimit: config.freeMessageLimit,
      hasApiKey,
      pinLength,
      customTags,
      persona,
      customInstructions: userRecord.custom_instructions || "",
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
    if (!apiKey) return res.status(400).json({ error: "API key is required" });

    const { error } = await supabase
      .from("users")
      .update({ user_api_key: apiKey.trim() })
      .eq("username", req.user!.username);

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
