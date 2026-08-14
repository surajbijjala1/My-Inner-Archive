/**
 * rate-limit.ts
 * Request throttles. The backend previously had none anywhere — including the
 * auth endpoints, which is a brute-force surface against a 4-digit PIN
 * (10,000 possibilities is minutes of unthrottled guessing).
 *
 * Keyed by username where we have one, so a shared NAT/carrier IP doesn't let
 * one user throttle everyone else.
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

/** Login/register: the brute-force surface. Deliberately tight. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = (req.body as { username?: string } | undefined)?.username;
    return username ? `auth:${username}` : `auth-ip:${ipKey(req)}`;
  },
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

/** Chat: generous enough for real conversation, bounded enough to cap spend. */
export const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "You're sending messages very quickly. Give it a moment." },
});

/** OCR + TTS: expensive per call (vision quota / audio synthesis). */
export const heavyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: "Too many requests. Please slow down." },
});
