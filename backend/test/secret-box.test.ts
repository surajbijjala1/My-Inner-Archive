import { test } from "node:test";
import assert from "node:assert/strict";
import { sealApiKey, openApiKey } from "../src/lib/secret-box.js";

const fake = "AIzaFAKE-not-a-real-key-0123456789abcdef";
const quietly = <T>(fn: () => T): T => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test("stored form never contains the plaintext", () => {
  const sealed = sealApiKey(fake, "alice");
  assert.ok(sealed.startsWith("enc:v1:"));
  assert.ok(!sealed.includes("AIza"));
});

test("round trips, with a fresh nonce each time", () => {
  const a = sealApiKey(fake, "alice"), b = sealApiKey(fake, "alice");
  assert.notEqual(a, b);
  assert.equal(openApiKey(a, "alice"), fake);
});

test("a ciphertext copied to another user doesn't decrypt", () => {
  assert.equal(quietly(() => openApiKey(sealApiKey(fake, "alice"), "bob")), null);
});

test("tampering is detected", () => {
  const sealed = sealApiKey(fake, "alice");
  const raw = Buffer.from(sealed.slice(7), "base64"); raw[raw.length - 1] ^= 1;
  assert.equal(quietly(() => openApiKey("enc:v1:" + raw.toString("base64"), "alice")), null);
});

test("legacy plaintext and empty values", () => {
  assert.equal(openApiKey("AIzaLEGACY", "alice"), "AIzaLEGACY");
  assert.equal(openApiKey(null, "alice"), null);
});
