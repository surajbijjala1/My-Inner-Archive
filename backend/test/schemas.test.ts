import { test } from "node:test";
import assert from "node:assert/strict";
import { MoodScoreSchema, SegmentedEntryArraySchema, parseStructured } from "../src/lib/schemas.js";

test("mood scores parse from JSON, fences and stringified numbers", async () => {
  assert.equal((await parseStructured('{"score": 8}', MoodScoreSchema)).score, 8);
  assert.equal((await parseStructured('```json\n{"score":3}\n```', MoodScoreSchema)).score, 3);
  assert.equal((await parseStructured('{"score":"7"}', MoodScoreSchema)).score, 7);
});

test("out-of-range or non-JSON mood scores are rejected (the old 8/10 → 810 bug)", async () => {
  for (const raw of ['{"score": 42}', '{"score": 0}', "8/10", "not json", ""]) {
    await assert.rejects(parseStructured(raw, MoodScoreSchema), `accepted ${JSON.stringify(raw)}`);
  }
});

test("one repair attempt recovers invalid output", async () => {
  const warn = console.warn; console.warn = () => {};
  const r = await parseStructured("oops", MoodScoreSchema, async () => '{"score":6}');
  console.warn = warn;
  assert.equal(r.score, 6);
});

test("segmentation coerces bad fields instead of failing the page", async () => {
  const [e] = await parseStructured('[{"text":"hi","tag":"","mood":99,"date":"bogus"}]', SegmentedEntryArraySchema);
  assert.deepEqual({ tag: e.tag, mood: e.mood, date: e.date }, { tag: "Reflecting", mood: 5, date: null });
  const [m] = await parseStructured('[{"text":"no tag","mood":5}]', SegmentedEntryArraySchema);
  assert.equal(m.tag, "Reflecting");
  await assert.rejects(parseStructured('{"not":"an array"}', SegmentedEntryArraySchema));
});
