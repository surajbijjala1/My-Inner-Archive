// daily-notification — Supabase Edge Function (Deno)
// Triggered every 15 minutes by pg_cron (see 0004_cron.sql). For each user
// whose local time matches one of their configured notification slots:
//   1. Build the motivation pool: mood_user ≥ 7 OR mood ≥ 7 OR is_favorite
//   2. Pick one entry weighted by recency + mood + variety (never the same
//      entry twice in a row)
//   3. Send an excerpt via FCM HTTP v1 to all their devices
//   4. Record the slot so it never double-sends
//
// Background-job fallback policy: on any failure, skip the slot — the next
// matching slot retries. No user-facing path depends on this.
//
// Required secrets:
//   FIREBASE_SERVICE_ACCOUNT — full service-account JSON (one line) from
//     Firebase console → Project settings → Service accounts → Generate key
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const SLOT_MINUTES = 15;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── FCM HTTP v1 auth: service-account JWT → OAuth2 access token ─────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const jwt = `${header}.${claims}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

/** Returns false when the token is dead and should be deleted. */
async function sendFcm(
  sa: ServiceAccount,
  accessToken: string,
  deviceToken: string,
  title: string,
  body: string,
  entryId: string,
): Promise<boolean> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data: { entry_id: entryId },
          android: { priority: "high" },
        },
      }),
    },
  );
  if (res.ok) return true;
  const text = await res.text();
  console.warn(`FCM send failed ${res.status}: ${text.slice(0, 200)}`);
  // UNREGISTERED / NOT_FOUND → token is dead
  return !(res.status === 404 || text.includes("UNREGISTERED"));
}

// ── Slot matching & entry selection ──────────────────────────────────────────

function floorToSlot(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const floored = Math.floor(m / SLOT_MINUTES) * SLOT_MINUTES;
  return `${String(h).padStart(2, "0")}:${String(floored).padStart(2, "0")}`;
}

function localNow(timezone: string): { hhmm: string; date: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    hhmm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

interface PoolEntry {
  id: string;
  text: string;
  mood: number | null;
  mood_user: number | null;
  is_favorite: boolean;
  created_at: string;
}

/** Weighted pick: mood 50%, recency 30%, variety 20%; favorites boosted. */
function pickEntry(pool: PoolEntry[], excludeId: string | null): PoolEntry | null {
  const candidates = pool.filter((e) => e.id !== excludeId);
  const usable = candidates.length > 0 ? candidates : pool;
  if (usable.length === 0) return null;

  const now = Date.now();
  const scored = usable.map((e) => {
    const mood = Math.max(e.mood_user ?? 0, e.mood ?? 0) / 10;
    const ageDays = (now - new Date(e.created_at).getTime()) / 86_400_000;
    const recency = Math.exp(-ageDays / 60); // half-life ~6 weeks
    const favBoost = e.is_favorite ? 0.15 : 0;
    return { e, w: 0.5 * mood + 0.3 * recency + 0.2 * Math.random() + favBoost };
  });
  scored.sort((a, b) => b.w - a.w);
  return scored[0].e;
}

// ── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const saRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!saRaw) {
    return new Response(JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT secret not set" }), { status: 500 });
  }
  const sa = JSON.parse(saRaw) as ServiceAccount;

  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("username, notify_times, notify_timezone, last_notified_entry_id, last_notified_slot")
    .eq("notify_enabled", true);

  if (usersErr) return new Response(JSON.stringify({ error: usersErr.message }), { status: 500 });

  let accessToken: string | null = null;
  const results: Record<string, string> = {};

  for (const user of users || []) {
    try {
      const tz = user.notify_timezone || "UTC";
      const { hhmm, date } = localNow(tz);
      const currentSlot = floorToSlot(hhmm);
      const times: string[] = Array.isArray(user.notify_times) ? user.notify_times : [];

      if (!times.some((t) => floorToSlot(t) === currentSlot)) continue; // not this user's slot
      const slotKey = `${date} ${currentSlot}`;
      if (user.last_notified_slot === slotKey) continue; // already sent this slot

      const { data: tokens } = await supabase
        .from("device_tokens")
        .select("token")
        .eq("username", user.username);
      if (!tokens || tokens.length === 0) {
        results[user.username] = "skipped: no devices";
        continue;
      }

      const { data: pool } = await supabase
        .from("entries")
        .select("id, text, mood, mood_user, is_favorite, created_at")
        .eq("username", user.username)
        .or("mood_user.gte.7,mood.gte.7,is_favorite.eq.true");

      const entry = pickEntry((pool || []) as PoolEntry[], user.last_notified_entry_id);
      if (!entry) {
        results[user.username] = "skipped: empty pool";
        continue;
      }

      const excerpt = entry.text.length > 160 ? entry.text.slice(0, 157) + "..." : entry.text;
      accessToken ??= await getAccessToken(sa);

      let delivered = 0;
      for (const { token } of tokens) {
        const alive = await sendFcm(sa, accessToken, token, "🌱 From your archive", excerpt, entry.id);
        if (alive) delivered++;
        else await supabase.from("device_tokens").delete().eq("token", token);
      }

      await supabase
        .from("users")
        .update({ last_notified_entry_id: entry.id, last_notified_slot: slotKey })
        .eq("username", user.username);

      results[user.username] = `sent to ${delivered}/${tokens.length} devices`;
    } catch (e) {
      // Skip the slot; the next matching slot retries
      console.error(`daily-notification failed for ${user.username}:`, (e as Error).message);
      results[user.username] = `failed: ${(e as Error).message}`;
    }
  }

  return new Response(JSON.stringify({ checked: (users || []).length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
