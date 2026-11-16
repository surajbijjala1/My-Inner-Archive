// Saving an entry spends shared-key AI quota in the background, so the save
// routes are throttled per user. Exercised through a real Express app.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { entryBatchLimiter, entryWriteLimiter } from "../src/middleware/rate-limit.js";
import type { AuthedRequest } from "../src/types.js";

let server: Server;
let base: string;

before(async () => {
  const app = express();
  // Stand-in for the auth middleware: the limiter keys on req.user.username.
  app.use((req: AuthedRequest, _res, next) => {
    req.user = { username: String(req.headers["x-test-user"]) };
    next();
  });
  app.post("/entries", entryWriteLimiter, (_req, res) => void res.json({ ok: true }));
  app.post("/entries/batch", entryBatchLimiter, (_req, res) => void res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function hit(path: string, user: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    const res = await fetch(base + path, { method: "POST", headers: { "x-test-user": user } });
    await res.arrayBuffer();
    statuses.push(res.status);
  }
  return statuses;
}

test("a user's 31st entry in a minute is refused; another user is unaffected", async () => {
  const alice = await hit("/entries", "alice", 31);
  assert.ok(alice.slice(0, 30).every((s) => s === 200), "first 30 pass");
  assert.equal(alice[30], 429);
  assert.deepEqual(await hit("/entries", "bob", 1), [200]);
});

test("bulk import has its own, smaller budget", async () => {
  const carol = await hit("/entries/batch", "carol", 11);
  assert.ok(carol.slice(0, 10).every((s) => s === 200), "first 10 pass");
  assert.equal(carol[10], 429);
  // …and is counted separately from single saves
  assert.deepEqual(await hit("/entries", "carol", 1), [200]);
});

test("the refusal uses the API's { error } shape", async () => {
  await hit("/entries", "dave", 30);
  const res = await fetch(base + "/entries", { method: "POST", headers: { "x-test-user": "dave" } });
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error?: string };
  assert.equal(typeof body.error, "string");
});
