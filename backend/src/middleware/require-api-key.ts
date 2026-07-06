/**
 * require-api-key.ts
 * Gate for OCR features (pre-approved decision #12): owner + own-API-key users
 * only. Trial users get an explanatory 403. On success, attaches the resolved
 * Gemini key to req.ocrApiKey.
 */

import type { Response, NextFunction } from "express";
import { supabase } from "../lib/supabase.js";
import { config } from "../config.js";
import type { AuthedRequest } from "../types.js";

export interface OcrRequest extends AuthedRequest {
  ocrApiKey?: string;
}

export async function requireApiKey(
  req: OcrRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const username = req.user!.username;

    if (username === config.ownerUsername) {
      req.ocrApiKey = config.googleApiKeyOwner;
      return next();
    }

    const { data } = await supabase
      .from("users")
      .select("user_api_key")
      .eq("username", username)
      .single();

    if (data?.user_api_key) {
      req.ocrApiKey = data.user_api_key;
      return next();
    }

    res.status(403).json({
      error: "ocr_requires_api_key",
      message:
        "Photo import uses AI vision, which isn't included in the free trial. " +
        "Add your own free Google Gemini API key in the chat panel to unlock it.",
    });
  } catch (e) {
    console.error("[ERROR] requireApiKey |", (e as Error).message);
    res.status(500).json({ error: "Failed to verify API key access" });
  }
}
