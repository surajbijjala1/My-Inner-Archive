// Shared-secret gate for the cron-triggered Edge Functions.
//
// Both functions are deployed with --no-verify-jwt (pg_cron has no user JWT to
// send), which left them callable by anyone who knew the project URL: trigger
// a Gemini summary run for every user, or push notifications to any named
// user's devices via test mode. pg_cron now sends a secret header read from
// Supabase Vault (migration 0009), and every request without it is refused.
//
// Fails closed: if CRON_SECRET isn't configured, nothing runs.

const HEADER = "x-cron-secret";

/** Constant-time string compare, so response timing can't leak the secret. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

/** Returns a rejection Response, or null when the caller is authorized. */
export function rejectUnlessCron(req: Request): Response | null {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    console.error("CRON_SECRET is not set — refusing all requests");
    return new Response(JSON.stringify({ error: "Not configured" }), { status: 503 });
  }
  const given = req.headers.get(HEADER) ?? "";
  if (!safeEqual(given, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  return null;
}
