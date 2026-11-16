// The error handler and headers, exercised through a real Express app on an
// ephemeral localhost port (no outside network).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { jsonErrorHandler, securityHeaders } from "../src/middleware/http-hardening.js";

let server: Server;
let base: string;
const logged: string[] = [];
const realError = console.error;

before(async () => {
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "1kb" }));
  app.post("/echo", (req, res) => void res.json({ ok: true, got: req.body }));
  app.get("/boom", () => {
    throw new Error("db password is hunter2 at /srv/app/secret.ts");
  });
  app.get("/audio", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ ok: true });
  });
  app.use(jsonErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  console.error = realError;
  await new Promise((resolve) => server.close(resolve));
});

const post = (body: string) =>
  fetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body });

test("malformed JSON gets a JSON 400 with no stack, path or body echo", async () => {
  logged.length = 0;
  const res = await post('{"text": "my private diary line", ');
  const text = await res.text();
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(JSON.parse(text), { error: "Invalid JSON body" });
  assert.doesNotMatch(text, /node_modules|at \w|diary/);
  assert.equal(logged.length, 1);
  assert.doesNotMatch(logged[0], /diary|private/, "the body is not quoted into the log");
});

test("an oversized body gets a JSON 413", async () => {
  const res = await post(JSON.stringify({ text: "x".repeat(5000) }));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "Request body too large" });
});

test("an unexpected throw is a generic 500: message and paths stay server-side", async () => {
  logged.length = 0;
  const res = await fetch(`${base}/boom`);
  const text = await res.text();
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(text), { error: "Internal server error" });
  assert.doesNotMatch(text, /hunter2|secret\.ts/);
  assert.match(logged[0], /hunter2/, "still logged for the operator");
});

test("responses are no-store + nosniff, without x-powered-by; routes can override caching", async () => {
  const ok = await post(JSON.stringify({ a: 1 }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ok.headers.get("x-powered-by"), null);

  const bad = await post("{");
  assert.equal(bad.headers.get("cache-control"), "no-store");

  const audio = await fetch(`${base}/audio`);
  assert.equal(audio.headers.get("cache-control"), "public, max-age=60");
});
