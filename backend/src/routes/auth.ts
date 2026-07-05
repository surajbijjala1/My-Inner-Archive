import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../lib/supabase.js";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

// POST /auth/register — create account with username, pin, and pin_length
router.post("/register", async (req, res) => {
  try {
    const { username, pin, pin_length } = req.body as {
      username?: string;
      pin?: string;
      pin_length?: number;
    };
    const pinLen = pin_length === 6 ? 6 : 4;

    if (!username?.trim()) return res.status(400).json({ error: "Username is required" });
    if (!pin || pin.length !== pinLen) {
      return res.status(400).json({ error: `PIN must be ${pinLen} digits` });
    }

    const hash = await bcrypt.hash(pin, 10);
    const { error } = await supabase
      .from("users")
      .insert({ username: username.trim(), pin_hash: hash, pin_length: pinLen });

    if (error) {
      // Supabase may surface PG error code in error.code OR only in error.message
      if (
        error.code === "23505" ||
        error.message?.includes("duplicate key") ||
        error.message?.includes("unique constraint")
      ) {
        return res.status(409).json({ error: "Username already exists. Try a different name." });
      }
      return res.status(400).json({ error: error.message });
    }
    const token = jwt.sign({ username: username.trim() }, config.jwtSecret, { expiresIn: "30d" });
    res.json({ token });
  } catch (e) {
    console.error("[ERROR] Register |", (e as Error).message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// GET /auth/check-username?username=x — check if a username is available (unauthenticated)
router.get("/check-username", async (req, res) => {
  try {
    const username = req.query.username as string | undefined;
    if (!username?.trim()) return res.json({ available: false });

    const { data } = await supabase
      .from("users")
      .select("username")
      .eq("username", username.trim())
      .single();

    res.json({ available: !data });
  } catch (e) {
    console.error("[ERROR] CheckUsername |", (e as Error).message);
    res.status(500).json({ error: "Failed to check username" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, pin } = req.body as { username?: string; pin?: string };
    if (!username || !pin) return res.status(400).json({ error: "username and pin required" });

    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (!data) return res.status(404).json({ error: "User not found" });
    const valid = await bcrypt.compare(pin, data.pin_hash);
    if (!valid) return res.status(401).json({ error: "Wrong PIN" });

    const token = jwt.sign({ username }, config.jwtSecret, { expiresIn: "30d" });
    res.json({ token, pin_length: data.pin_length || 4 });
  } catch (e) {
    console.error("[ERROR] Login |", (e as Error).message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// GET /auth/pin-length?username=x — unauthenticated, used by login screen to size dots
router.get("/pin-length", async (req, res) => {
  try {
    const username = req.query.username as string | undefined;
    if (!username) return res.status(400).json({ error: "username required" });

    const { data } = await supabase
      .from("users")
      .select("pin_length")
      .eq("username", username)
      .single();

    res.json({ pin_length: data?.pin_length || 4 });
  } catch (e) {
    console.error("[ERROR] PinLength |", (e as Error).message);
    res.status(500).json({ error: "Failed to fetch PIN length" });
  }
});

// POST /auth/change-pin — JWT protected, verify current PIN then set new
router.post("/change-pin", auth, async (req: AuthedRequest, res) => {
  try {
    const { current_pin, new_pin } = req.body as { current_pin?: string; new_pin?: string };
    const username = req.user!.username;

    const { data } = await supabase
      .from("users")
      .select("pin_hash, pin_length")
      .eq("username", username)
      .single();

    if (!data) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(current_pin ?? "", data.pin_hash);
    if (!valid) return res.status(401).json({ error: "Current PIN is incorrect" });

    if (!new_pin || (new_pin.length !== 4 && new_pin.length !== 6)) {
      return res.status(400).json({ error: "New PIN must be 4 or 6 digits" });
    }

    const newHash = await bcrypt.hash(new_pin, 10);
    const { error } = await supabase
      .from("users")
      .update({ pin_hash: newHash, pin_length: new_pin.length })
      .eq("username", username);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error("[ERROR] ChangePin |", (e as Error).message);
    res.status(500).json({ error: "Failed to change PIN" });
  }
});

export default router;
