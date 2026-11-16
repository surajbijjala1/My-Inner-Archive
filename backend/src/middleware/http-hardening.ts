/**
 * http-hardening.ts
 * Response headers and a last-resort error handler for the whole API.
 *
 * Without an error handler, anything that failed before a route's own
 * try/catch — a malformed or oversized JSON body, most often — fell through to
 * Express's default handler, which answers in HTML and, unless NODE_ENV is
 * "production", includes the stack trace with server file paths. It also
 * logged the parser's message, which quotes the first characters of the body.
 */

import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";

/**
 * - no-store: responses carry journal entries and chat history behind a bearer
 *   token; they must not be written to a browser's or WebView's disk cache.
 *   Routes that set their own Cache-Control (TTS) still win.
 * - nosniff: every response is JSON or audio; never let a browser guess.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

interface HttpishError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
  name?: unknown;
  message?: unknown;
}

function publicMessage(status: number, type: string): string {
  if (type === "entity.parse.failed") return "Invalid JSON body";
  if (status === 413) return "Request body too large";
  if (status >= 500) return "Internal server error";
  return "Bad request";
}

/** Mount LAST. Always answers `{ error: string }`, never a stack or a path. */
export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const e = (err ?? {}) as HttpishError;
  const raw = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : 500;
  const status = raw >= 400 && raw <= 599 ? raw : 500;
  const type = typeof e.type === "string" ? e.type : typeof e.name === "string" ? e.name : "Error";

  // 4xx: log the kind only — a body-parser message echoes part of the body,
  // which here can be journal text. 5xx: the message is needed to debug.
  const detail = status >= 500 && typeof e.message === "string" ? ` | ${e.message.slice(0, 200)}` : "";
  console.error(`[ERROR] Unhandled | ${req.method} ${req.path} | ${status} | ${type}${detail}`);

  res.status(status).json({ error: publicMessage(status, type) });
};
