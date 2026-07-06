/**
 * ocr.ts
 * Image → text extraction (Features 7 & 8).
 * Primary: Gemini Flash Vision. Fallback: tesseract.js (eng + hin + tel),
 * per the pre-approved decision — no Python services.
 */

import { GoogleGenAI } from "@google/genai";
import { createWorker } from "tesseract.js";
import { config } from "./config.js";

const EXTRACTION_PROMPT =
  "Extract all text from this image exactly as written, preserving line breaks and " +
  "paragraph structure. If the text is handwritten, do your best to capture it accurately. " +
  "If the text is in a language other than English, extract it in its original language " +
  "and also provide an English translation. Return only the extracted text, nothing else.";

export interface OcrResult {
  text: string;
  /** Which engine produced the text. */
  engine: "gemini" | "tesseract";
  /** Set when the caller should show a caveat to the user. */
  warning: "no_text" | "partial" | null;
}

async function geminiVisionExtract(
  imageBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: config.geminiVisionModel,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });
  return (response.text ?? "").trim();
}

// Tesseract worker is expensive to boot (downloads traineddata on first use),
// so keep one alive and reuse it across requests.
let tesseractWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

async function getTesseractWorker() {
  if (!tesseractWorker) {
    tesseractWorker = await createWorker(["eng", "hin", "tel"]);
  }
  return tesseractWorker;
}

async function tesseractExtract(
  imageBase64: string,
  mimeType: string
): Promise<{ text: string; confidence: number }> {
  const worker = await getTesseractWorker();
  const buffer = Buffer.from(imageBase64, "base64");
  void mimeType; // tesseract sniffs the format from the buffer
  const { data } = await worker.recognize(buffer);
  return { text: data.text.trim(), confidence: data.confidence };
}

/**
 * Extract text from an image. Tries Gemini Flash Vision; on any failure
 * (API error, rate limit, timeout) falls back to tesseract.js.
 */
export async function extractText(
  imageBase64: string,
  mimeType: string,
  apiKey: string
): Promise<OcrResult> {
  try {
    const text = await geminiVisionExtract(imageBase64, mimeType, apiKey);
    if (!text) return { text: "", engine: "gemini", warning: "no_text" };
    return { text, engine: "gemini", warning: null };
  } catch (e) {
    console.warn("⚠️  Gemini Vision failed, falling back to tesseract.js:", (e as Error).message);
  }

  try {
    const { text, confidence } = await tesseractExtract(imageBase64, mimeType);
    if (!text) return { text: "", engine: "tesseract", warning: "no_text" };
    // Low tesseract confidence → tell the user some text may be missing
    return { text, engine: "tesseract", warning: confidence < 60 ? "partial" : null };
  } catch (e) {
    console.error("[ERROR] tesseract fallback failed:", (e as Error).message);
    throw new Error("OCR failed on both engines");
  }
}

// ─── Bulk import: second LLM pass (Feature 8) ────────────────────────────────

export interface SegmentedEntry {
  text: string;
  tag: string;
  mood: number;
  /** ISO date (YYYY-MM-DD) when detectable from the page, else null. */
  date: string | null;
}

const SEGMENTATION_PROMPT = (pageText: string) => `The text below was OCR-extracted from a physical journal page. A single page may contain multiple days or separate thoughts.

Segment it into individual journal entries. For each entry provide:
- "text": the entry text, cleaned of OCR artifacts but otherwise verbatim
- "tag": a short activity/context tag (e.g. "Reflecting", "Walking", "Reading")
- "mood": estimated mood score 1-10 (1 = deeply negative, 5 = neutral, 10 = very positive)
- "date": the entry's date as YYYY-MM-DD if written or inferable on the page, otherwise null. Journal pages often write dates without a year (e.g. "March 3rd") — in that case assume the most recent occurrence of that date on or before today (today is ${new Date().toISOString().slice(0, 10)})

Return a JSON array. If the whole page is one entry, return a single-element array.

PAGE TEXT:
${pageText}`;

/**
 * Segment an OCR'd page into individual entries with suggested metadata.
 * Gemini-only (this feature is gated to users with working Gemini keys);
 * throws on failure so the UI can let the user retry the page.
 */
export async function segmentPage(pageText: string, apiKey: string): Promise<SegmentedEntry[]> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: SEGMENTATION_PROMPT(pageText),
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            tag: { type: "string" },
            mood: { type: "integer" },
            date: { type: "string", nullable: true },
          },
          required: ["text", "tag", "mood"],
        },
      },
    },
  });

  const raw = (response.text ?? "").trim();
  const parsed = JSON.parse(raw) as SegmentedEntry[];
  return parsed
    .filter((e) => e.text?.trim())
    .map((e) => ({
      text: e.text.trim(),
      tag: e.tag?.trim() || "Reflecting",
      mood: Math.round(Math.max(1, Math.min(10, e.mood ?? 5))),
      date: e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null,
    }));
}
