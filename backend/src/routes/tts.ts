/**
 * tts.ts — text-to-speech for voice chat (Phase 4).
 *
 * POST /tts { text, persona? } → streaming MP3 synthesized by Edge neural
 * voices (msedge-tts, no API key needed). Each persona maps to its own voice
 * in config.ts. This is a free unofficial service, so the client treats ANY
 * failure here as a cue to fall back to on-device SpeechSynthesis.
 */

import { Router } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";
import type { AuthedRequest } from "../types.js";

const router = Router();

router.post("/", auth, async (req: AuthedRequest, res) => {
  try {
    const { text, persona } = req.body as { text?: string; persona?: string };

    const clean = (text || "").trim();
    if (!clean) return res.status(400).json({ error: "text is required" });
    if (clean.length > config.ttsMaxChars) {
      return res.status(400).json({ error: `text exceeds ${config.ttsMaxChars} characters` });
    }

    const voice = (persona && config.ttsVoices[persona]) || config.ttsVoiceDefault;

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(clean);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    audioStream.on("error", (e: Error) => {
      console.error(`[ERROR] TTS stream | user=${req.user?.username} |`, e.message);
      if (!res.headersSent) {
        res.status(502).json({ error: "TTS synthesis failed" });
      } else {
        res.destroy();
      }
      tts.close();
    });
    audioStream.on("end", () => tts.close());
    // If the client bails (voice mode closed mid-playback), stop synthesizing
    res.on("close", () => tts.close());

    audioStream.pipe(res);
  } catch (e) {
    console.error(`[ERROR] TTS | user=${req.user?.username} |`, (e as Error).message);
    if (!res.headersSent) res.status(502).json({ error: "TTS unavailable" });
  }
});

export default router;
