import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UpstreamError, isRetryable, retryAfterMs, withRetry, withTimeout, TimeoutError,
  CircuitBreaker, geminiBreaker, breakerHealth,
} from "../src/lib/resilience.js";
import { config } from "../src/config.js";

const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test("only transient failures are retryable", () => {
  assert.ok(isRetryable(new UpstreamError("rate", 429)));
  assert.ok(isRetryable(new UpstreamError("busy", 503)));
  assert.ok(!isRetryable(new UpstreamError("bad request", 400)));
  assert.ok(!isRetryable(new UpstreamError("unauthorized", 401)));
  assert.ok(isRetryable(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })));
});

test("Gemini's in-body retry hints are parsed", () => {
  assert.ok(retryAfterMs(new Error('{"message":"Please retry in 1.7s."}'))! >= 1700);
  assert.equal(retryAfterMs(new Error('"retryDelay": "2s"')), 2000);
  assert.equal(retryAfterMs(new Error("retry-after: 30")), 30_000);
  assert.equal(retryAfterMs(new Error("boom")), undefined);
});

test("a hint longer than the cap fails immediately instead of sleeping", async () => {
  const restore = quiet();
  let calls = 0; const t = Date.now();
  await assert.rejects(withRetry(() => { calls++; throw new UpstreamError("q", 429, 60_000); }, { maxDelayMs: 2000 }));
  restore();
  assert.equal(calls, 1);
  assert.ok(Date.now() - t < 200);
});

test("a short hint is honoured", async () => {
  const restore = quiet();
  let calls = 0; const t = Date.now();
  const v = await withRetry(async () => { if (++calls < 2) throw new UpstreamError("q", 429, 100); return "ok"; }, { maxDelayMs: 2000 });
  restore();
  assert.equal(v, "ok"); assert.equal(calls, 2); assert.ok(Date.now() - t >= 95);
});

test("non-retryable errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(withRetry(() => { calls++; throw new UpstreamError("bad", 400); }));
  assert.equal(calls, 1);
});

test("withTimeout aborts and throws TimeoutError", async () => {
  await assert.rejects(
    withTimeout(30, (s) => new Promise((_, rej) => s.addEventListener("abort", () => rej(new Error("aborted"))))),
    TimeoutError,
  );
});

test("circuit breaker opens, fails fast, then recovers", async () => {
  const restore = quiet(); const log = console.log; console.log = () => {};
  const b = new CircuitBreaker("t", 3, 40);
  for (let i = 0; i < 3; i++) await b.run(() => Promise.reject(new UpstreamError("x", 503))).catch(() => {});
  assert.equal(b.status.state, "open");
  await assert.rejects(b.run(() => Promise.resolve(1)), /circuit open/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await b.run(() => Promise.resolve("ok")), "ok");
  assert.equal(b.status.state, "closed");
  restore(); console.log = log;
});

test("4xx never trips a breaker", async () => {
  const b = new CircuitBreaker("t4", 3, 1000);
  for (let i = 0; i < 6; i++) await b.run(() => Promise.reject(new UpstreamError("bad", 400))).catch(() => {});
  assert.equal(b.status.state, "closed");
});

test("breakers are isolated per API key and model", async () => {
  const restore = quiet();
  const T = config.googleApiKeyTrial, O = config.googleApiKeyOwner;
  const main = config.geminiModel, fallback = config.geminiChatFallbacks[0];
  for (let i = 0; i < 6; i++) await geminiBreaker(T, main).run(() => Promise.reject(new UpstreamError("q", 429))).catch(() => {});
  restore();
  assert.equal(geminiBreaker(T, main).status.state, "open");
  assert.equal(await geminiBreaker(T, fallback).run(() => Promise.resolve("ok")), "ok");
  assert.equal(await geminiBreaker(O, main).run(() => Promise.resolve("ok")), "ok");
  assert.equal(await geminiBreaker("user-key", main).run(() => Promise.resolve("ok")), "ok");
});

test("/health breaker summary never contains key material", () => {
  geminiBreaker("AIzaSECRET-user-key", config.geminiModel);
  const h = JSON.stringify(breakerHealth());
  for (const secret of ["AIzaSECRET", config.googleApiKeyTrial, config.googleApiKeyOwner]) {
    assert.ok(!h.includes(secret), `leaked ${secret}`);
  }
});
