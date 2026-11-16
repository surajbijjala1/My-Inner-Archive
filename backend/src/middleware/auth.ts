/**
 * Shared JWT auth middleware. Attaches the verified payload as req.user.
 * Responds 401 { error: "Unauthorized" } on any missing/invalid token.
 */

import jwt from "jsonwebtoken";
import type { Response, NextFunction } from "express";
import { config } from "../config.js";
import type { AuthedRequest, AuthUser } from "../types.js";

/**
 * Verify a token and return its user, or null.
 *
 * - The algorithm is pinned to the one we sign with (HS256) instead of
 *   accepting whatever HMAC variant the token's own header asks for.
 * - The payload must carry a non-empty string username. Every query is
 *   scoped by `req.user.username`, so a token that verifies but has no usable
 *   username must be refused here, not reach a `.eq("username", undefined)`.
 */
export function verifyToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || payload === null) return null;
    const username = (payload as { username?: unknown }).username;
    if (typeof username !== "string" || username.length === 0) return null;
    return payload as AuthUser;
  } catch {
    return null;
  }
}

export function auth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const user = verifyToken(req.headers.authorization?.split(" ")[1]);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}
