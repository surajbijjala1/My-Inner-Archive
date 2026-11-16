/**
 * request-context.ts
 * Gives every request an id carried through AsyncLocalStorage, so spans emitted
 * deep in the AI layer — including from fire-and-forget setImmediate work that
 * outlives the HTTP response — can be tied back to the request that caused them.
 *
 * Without this, concurrent turns produced interleaved log lines with no way to
 * separate them, and background embed/mood work was correlatable only by
 * entry id.
 */

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { runWithContext } from "../lib/telemetry.js";
import type { AuthedRequest } from "../types.js";
import { safeRequestId } from "../lib/limits.js";

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  // A client may supply its own id for correlation, but only one that is safe
  // to echo into a header, log lines and trace attributes.
  const requestId = safeRequestId(req.headers["x-request-id"]) ?? randomUUID();
  res.setHeader("x-request-id", requestId);
  // auth runs after this, so username is attached later via setContextField
  runWithContext({ requestId, username: (req as AuthedRequest).user?.username }, () => next());
}
