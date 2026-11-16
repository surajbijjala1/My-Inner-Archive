// Every query is scoped by the username inside the JWT, so what counts as a
// valid token is the root of user isolation.
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { verifyToken } from "../src/middleware/auth.js";
import { config } from "../src/config.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);

test("a token signed the way the app signs them is accepted", () => {
  const token = jwt.sign({ username: "alice" }, config.jwtSecret, { expiresIn: "30d" });
  assert.equal(verifyToken(token)?.username, "alice");
});

test("missing, garbage, unsigned and wrongly-signed tokens are refused", () => {
  const good = jwt.sign({ username: "alice" }, config.jwtSecret, { expiresIn: "1h" });
  const [h, , sig] = good.split(".");
  const refused: (string | undefined)[] = [
    undefined,
    "",
    "not-a-jwt",
    // alg=none, no signature
    `${b64({ alg: "none", typ: "JWT" })}.${b64({ username: "bob", exp: now + 3600 })}.`,
    // signed with another secret
    jwt.sign({ username: "bob" }, "some-other-secret", { expiresIn: "1h" }),
    // alice's header + signature around bob's payload
    `${h}.${b64({ username: "bob", exp: now + 3600 })}.${sig}`,
    // expired
    jwt.sign({ username: "alice", exp: now - 10 }, config.jwtSecret),
  ];
  for (const t of refused) assert.equal(verifyToken(t), null, String(t).slice(0, 40));
});

test("only HS256 is accepted, even with the right secret", () => {
  for (const algorithm of ["HS384", "HS512"] as const) {
    const token = jwt.sign({ username: "alice" }, config.jwtSecret, { algorithm, expiresIn: "1h" });
    assert.equal(verifyToken(token), null, algorithm);
  }
});

test("a validly signed token without a usable username is refused", () => {
  const payloads: unknown[] = [
    {},
    { username: "" },
    { username: null },
    { username: 42 },
    { username: ["alice"] },
    { username: { eq: "alice" } },
    { user: "alice" },
  ];
  for (const p of payloads) {
    const token = jwt.sign(p as object, config.jwtSecret, { expiresIn: "1h" });
    assert.equal(verifyToken(token), null, JSON.stringify(p));
  }
  // jwt.sign also accepts a bare string payload
  assert.equal(verifyToken(jwt.sign("alice", config.jwtSecret)), null);
});
