/**
 * schemas.ts
 * Every model-output contract in one place, validated with Zod.
 *
 * Before this, structured extraction was regex and unguarded JSON.parse:
 *   - mood: parseInt(raw.replace(/[^0-9]/g, "")) — so "8/10" became 810, threw,
 *     and left the entry unscored forever (silently, since scoring is
 *     fire-and-forget after the response is already sent)
 *   - segmentation: bare JSON.parse on model output, SyntaxError → 500
 *
 * Pair these with Gemini's responseSchema: the schema constrains generation,
 * Zod verifies what actually came back. Both, not either.
 */

import { z } from "zod";

/** Mood score. `coerce` handles a stringified number without regex surgery. */
export const MoodScoreSchema = z.object({
  score: z.coerce.number().int().min(1).max(10),
});
export type MoodScore = z.infer<typeof MoodScoreSchema>;

/** One entry suggested by the bulk-import segmentation pass. */
export const SegmentedEntrySchema = z.object({
  text: z.string().trim().min(1),
  // `.default()` only fires on undefined — an empty string from the model must
  // fall back too, which the pre-Zod `e.tag?.trim() || "Reflecting"` did.
  tag: z
    .string()
    .optional()
    .transform((t) => t?.trim() || "Reflecting"),
  mood: z.coerce.number().int().min(1).max(10).catch(5),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
});
export const SegmentedEntryArraySchema = z.array(SegmentedEntrySchema);

/** Retrieval gate verdict. */
export const IntentSchema = z.enum(["retrieve", "converse"]);

/** Safety gate verdict. */
export const SafetyVerdictSchema = z.enum(["crisis", "safe"]);

/** Gemini responseSchema fragments — kept beside their Zod counterparts so the
 *  two can't drift apart unnoticed. */
export const geminiSchemas = {
  moodScore: {
    type: "object",
    properties: { score: { type: "integer" } },
    required: ["score"],
  },
  segmentedEntries: {
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
} as const;

/** Strip ```json fences some models add despite responseMimeType. */
function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export class SchemaValidationError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/**
 * Parse JSON then validate. On failure optionally makes ONE repair attempt,
 * handing the model its own invalid output plus the validation error — cheaper
 * and far more effective than a blind retry of the original prompt.
 */
export async function parseStructured<T>(
  raw: string,
  schema: z.ZodType<T>,
  repair?: (raw: string, problem: string) => Promise<string>
): Promise<T> {
  const attempt = (input: string): { ok: true; value: T } | { ok: false; problem: string } => {
    let json: unknown;
    try {
      json = JSON.parse(stripFences(input));
    } catch (e) {
      return { ok: false, problem: `not valid JSON: ${(e as Error).message}` };
    }
    const result = schema.safeParse(json);
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, problem: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  };

  const first = attempt(raw);
  if (first.ok) return first.value;

  if (repair) {
    console.warn(`[WARN] structured output invalid (${first.problem}) — attempting repair`);
    try {
      const repaired = await repair(raw, first.problem);
      const second = attempt(repaired);
      if (second.ok) return second.value;
      throw new SchemaValidationError(`repair failed: ${second.problem}`, repaired);
    } catch (e) {
      if (e instanceof SchemaValidationError) throw e;
      throw new SchemaValidationError(`repair call failed: ${(e as Error).message}`, raw);
    }
  }

  throw new SchemaValidationError(first.problem, raw);
}
