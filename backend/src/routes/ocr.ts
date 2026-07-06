import { Router } from "express";
import express from "express";
import { auth } from "../middleware/auth.js";
import { requireApiKey, type OcrRequest } from "../middleware/require-api-key.js";
import { extractText, segmentPage } from "../ocr.js";

const router = Router();

// Images arrive as base64 JSON — needs a bigger body limit than the app default
router.use(express.json({ limit: "15mb" }));

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

// POST /ocr — extract text from one image (Feature 7)
router.post("/", auth, requireApiKey, async (req: OcrRequest, res) => {
  try {
    const { image, mimeType } = req.body as { image?: string; mimeType?: string };
    if (!image || !mimeType) {
      return res.status(400).json({ error: "image (base64) and mimeType are required" });
    }
    if (!ALLOWED_MIME.has(mimeType)) {
      return res.status(400).json({ error: `Unsupported image type: ${mimeType}` });
    }

    const start = performance.now();
    const result = await extractText(image, mimeType, req.ocrApiKey!);
    const elapsed = (performance.now() - start).toFixed(0);
    console.log(
      `[METRIC] OCR | user=${req.user!.username} | engine=${result.engine} | ` +
      `warning=${result.warning ?? "none"} | latency=${elapsed}ms | chars=${result.text.length}`
    );

    res.json(result);
  } catch (e) {
    console.error("[ERROR] OCR |", (e as Error).message);
    res.status(500).json({ error: "Text extraction failed. Please try again." });
  }
});

// POST /ocr/segment — split an OCR'd page into entries with metadata (Feature 8)
router.post("/segment", auth, requireApiKey, async (req: OcrRequest, res) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "text is required" });

    const entries = await segmentPage(text, req.ocrApiKey!);
    console.log(
      `[METRIC] Segment | user=${req.user!.username} | entries=${entries.length} | chars=${text.length}`
    );
    res.json({ entries });
  } catch (e) {
    console.error("[ERROR] Segment |", (e as Error).message);
    res.status(500).json({ error: "Could not segment this page. Please try again." });
  }
});

export default router;
