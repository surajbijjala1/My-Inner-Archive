/**
 * Shared JWT auth middleware. Attaches the verified payload as req.user.
 * Responds 401 { error: "Unauthorized" } on any missing/invalid token.
 */

import jwt from "jsonwebtoken";
import type { Response, NextFunction } from "express";
import { config } from "../config.js";
import type { AuthedRequest, AuthUser } from "../types.js";

export function auth(req: AuthedRequest, res: Response, next: NextFunction): void {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    req.user = jwt.verify(token!, config.jwtSecret) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
