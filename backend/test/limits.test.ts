// Input-shape checks used at the auth and request-context boundaries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasInvisibleChars, isPin, safeRequestId } from "../src/lib/limits.js";

test("isPin: exactly N digits, as a string", () => {
  assert.ok(isPin("0420", 4));
  assert.ok(isPin("739105", 6));
  const notPins: unknown[] = [
    "042", "04200", "04a0", "0420\n", " 420", "٠٤٢٠", "", null, undefined, 4200,
    ["0", "4", "2", "0"], { length: 4 },
  ];
  for (const v of notPins) assert.ok(!isPin(v, 4), JSON.stringify(v));
});

test("hasInvisibleChars: catches log-forging and look-alike characters only", () => {
  const hostile = ["a\nb", "alice\r\n[ERROR] forged", "a\tb", "a\u0000b", "alice​", "‮ecila", "a﻿b"];
  for (const v of hostile) assert.ok(hasInvisibleChars(v), JSON.stringify(v));
  const fine = ["alice", "Suraj B", "सूरज", "సూరజ్", "o'neil-smith_2", "名前", "émile", "🙂 me"];
  for (const v of fine) assert.ok(!hasInvisibleChars(v), v);
});

test("safeRequestId: echoes only short, plain ids", () => {
  assert.equal(safeRequestId("3f6c1a2e-9b7d-4c1e-8f2a-1b2c3d4e5f60"), "3f6c1a2e-9b7d-4c1e-8f2a-1b2c3d4e5f60");
  assert.equal(safeRequestId("trace.01:abc_DEF"), "trace.01:abc_DEF");
  const refused: unknown[] = ["", "a b", "x\r\nSet-Cookie: a=b", "<script>", "a".repeat(65), ["a", "b"], undefined, 7];
  for (const v of refused) assert.equal(safeRequestId(v), null, JSON.stringify(v));
});
