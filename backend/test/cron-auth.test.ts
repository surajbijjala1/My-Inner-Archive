// The Edge Functions' shared-secret gate is plain TS that only touches
// Deno.env, so it's tested here under Node with a minimal Deno stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";

let secret: string | undefined = "s3cret-value";
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === "CRON_SECRET" ? secret : undefined) } };
const { rejectUnlessCron } = await import("../../supabase/functions/_shared/cron-auth.ts");
const req = (h?: string) => new Request("http://x/", { headers: h === undefined ? {} : { "x-cron-secret": h } });

test("only the exact secret is allowed", () => {
  assert.equal(rejectUnlessCron(req("s3cret-value")), null);
  for (const h of [undefined, "", "s3cret", "s3cret-value!", "s3cret-valuX"]) {
    assert.equal(rejectUnlessCron(req(h))?.status, 401, String(h));
  }
});

test("fails closed when CRON_SECRET is unset", () => {
  secret = undefined;
  const e = console.error; console.error = () => {};
  assert.equal(rejectUnlessCron(req("anything"))?.status, 503);
  console.error = e;
});
