// The PIN limiter is the only thing between a 4-digit PIN and a full walk of
// its 10,000 values, so which bucket a request lands in is security-critical.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { pinLimiterKey } from "../src/middleware/rate-limit.js";

const req = (body: unknown, user?: { username: string }): Request =>
  ({ body, user, ip: "203.0.113.7" }) as unknown as Request;

test("login: bucket is the account named in the body", () => {
  assert.equal(pinLimiterKey(req({ username: "alice", pin: "0000" })), "pin:alice");
});

test("change-pin: a body username cannot move the request out of the token's bucket", () => {
  // The route checks the PIN of the JWT's account. Before this was fixed, a
  // fresh body username per guess gave every guess a fresh bucket.
  const keys = new Set(
    ["x1", "x2", "x3", "bob"].map((u) =>
      pinLimiterKey(req({ username: u, current_pin: "0000", new_pin: "1111" }, { username: "alice" }))
    )
  );
  assert.deepEqual([...keys], ["pin:alice"]);
});

test("login and change-pin share one budget per account", () => {
  assert.equal(
    pinLimiterKey(req({ username: "alice" })),
    pinLimiterKey(req({ current_pin: "0000" }, { username: "alice" }))
  );
});

test("a non-string body username lands in the same bucket as its string form", () => {
  // PostgREST filters stringify their value, so ["alice"] would look up
  // "alice" — it must not get a bucket of its own.
  assert.equal(pinLimiterKey(req({ username: ["alice"] })), "pin:alice");
});

test("no username at all falls back to the caller's IP", () => {
  for (const body of [undefined, {}, { username: "" }, { username: null }]) {
    assert.match(pinLimiterKey(req(body)), /^pin-ip:/);
  }
});
