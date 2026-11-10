/**
 * rate-limit.ts
 * Request throttles, one per abuse surface.
 *
 * Keys depend on two things being set up in index.ts:
 * - `trust proxy`, so req.ip is the client rather than Render's proxy (without
 *   it every user shares one IP bucket);
 * - `auth` running before chatLimiter/heavyLimiter, so they can key by the
 *   verified username instead of falling back to IP.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import type { AuthedRequest } from "../types.js";

/** IPv6-safe IP key (bare req.ip mis-buckets IPv6 subnets). */
const ipKey = (req: Request): string => ipKeyGenerator(req.ip ?? "");

const userOrIpKey = (req: Request): string => {
  const username = (req as AuthedRequest).user?.username;
  return username ? `u:${username}` : `ip:${ipKey(req)}`;
};

const common = { standardHeaders: "draft-7", legacyHeaders: false } as const;

/**
 * PIN guessing, on POST /auth/login and POST /auth/change-pin. Keyed by the
 * account being guessed (body username for login, the JWT's for change-pin),
 * so both routes share one budget per account: 10,000 four-digit PINs can't be
 * walked whichever door is used.
 */
export const pinLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 20,
  keyGenerator: (req) => {
    const username =
      (req.body as { username?: string } | undefined)?.username ??
      (req as AuthedRequest).user?.username;
    return username ? `pin:${username}` : `pin-ip:${ipKey(req)}`;
  },
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

/**
 * Account creation, keyed by IP. Keying by the submitted username (as the old
 * shared auth limiter did) gave every new name a fresh bucket, and each
 * account gets free trial messages on the shared key.
 */
export const registerLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: (req) => `register:${ipKey(req)}`,
  message: { error: "Too many accounts created from here. Please try again later." },
});

/** Unauthenticated lookups (username availability, PIN length). The sign-up
 *  form checks availability as you type, debounced, so this stays generous. */
export const lookupLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (req) => `lookup:${ipKey(req)}`,
  message: { error: "Too many requests. Please slow down." },
});

/** Chat: generous enough for real conversation, bounded enough to cap spend. */
export const chatLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 20,
  keyGenerator: userOrIpKey,
  message: { error: "You're sending messages very quickly. Give it a moment." },
});

/** OCR + TTS: expensive per call (vision quota / audio synthesis). */
export const heavyLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 30,
  keyGenerator: userOrIpKey,
  message: { error: "Too many requests. Please slow down." },
});
