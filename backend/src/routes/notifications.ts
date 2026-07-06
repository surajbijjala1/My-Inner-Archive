import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { auth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES = 4;

// POST /notifications/register — save an FCM device token for this user
router.post("/register", auth, async (req: AuthedRequest, res) => {
  try {
    const { token, platform } = req.body as { token?: string; platform?: string };
    if (!token?.trim()) return res.status(400).json({ error: "token is required" });

    const { error } = await supabase.from("device_tokens").upsert({
      token: token.trim(),
      username: req.user!.username,
      platform: platform === "ios" ? "ios" : "android",
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] RegisterToken |", (e as Error).message);
    res.status(500).json({ error: "Failed to register device" });
  }
});

// DELETE /notifications/register — remove a token (sign-out / opt-out)
router.delete("/register", auth, async (req: AuthedRequest, res) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token?.trim()) return res.status(400).json({ error: "token is required" });

    const { error } = await supabase
      .from("device_tokens")
      .delete()
      .eq("token", token.trim())
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] UnregisterToken |", (e as Error).message);
    res.status(500).json({ error: "Failed to unregister device" });
  }
});

// GET /notifications/settings
router.get("/settings", auth, async (req: AuthedRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("notify_enabled, notify_times, notify_timezone")
      .eq("username", req.user!.username)
      .single();

    if (error || !data) return res.status(404).json({ error: "User not found" });
    res.json({
      enabled: data.notify_enabled ?? false,
      times: data.notify_times ?? ["08:00", "18:00"],
      timezone: data.notify_timezone ?? null,
    });
  } catch (e) {
    console.error("[ERROR] GetNotifySettings |", (e as Error).message);
    res.status(500).json({ error: "Failed to load notification settings" });
  }
});

// POST /notifications/settings — { enabled, times: ["08:00", ...], timezone }
router.post("/settings", auth, async (req: AuthedRequest, res) => {
  try {
    const { enabled, times, timezone } = req.body as {
      enabled?: boolean;
      times?: string[];
      timezone?: string;
    };

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled (boolean) is required" });
    }
    if (!Array.isArray(times) || times.length === 0 || times.length > MAX_TIMES) {
      return res.status(400).json({ error: `times must have 1-${MAX_TIMES} entries` });
    }
    if (times.some((t) => !TIME_RE.test(t))) {
      return res.status(400).json({ error: "times must be HH:MM (24h)" });
    }
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        return res.status(400).json({ error: "Invalid timezone" });
      }
    }

    const { error } = await supabase
      .from("users")
      .update({
        notify_enabled: enabled,
        notify_times: [...new Set(times)].sort(),
        notify_timezone: timezone || null,
      })
      .eq("username", req.user!.username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] SaveNotifySettings |", (e as Error).message);
    res.status(500).json({ error: "Failed to save notification settings" });
  }
});

export default router;
