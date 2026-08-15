/**
 * resilience.ts
 * Shared retry / timeout / circuit-breaker primitives for every outbound AI call.
 *
 * Written because the codebase had three different ad-hoc approaches and one
 * total gap: mood scoring retried on a fixed [61s, 120s] ladder, the weekly
 * summary Edge Function used 2s/4s backoff with no jitter and retried
 * non-retryable 4xx, embeddings had no retry at all, and no Gemini call
 * anywhere had a timeout.
 */

/** Error carrying an upstream HTTP status so retry/fallback can classify it. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** Timed out against our own deadline (as opposed to the peer erroring). */
export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Retryable = transient. Explicitly NOT 4xx other than 429: a 400 means the
 * request is malformed and replaying it just burns quota. (The old
 * `message.includes("Ollama error")` check treated every non-2xx as transient.)
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof UpstreamError) {
    return err.status === 429 || err.status === 408 || err.status >= 500;
  }
  const e = err as { name?: string; code?: string; message?: string; status?: number };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return true;
  if (e?.code === "ECONNREFUSED" || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT") return true;
  if (typeof e?.status === "number") {
    return e.status === 429 || e.status === 408 || e.status >= 500;
  }
  const msg = e?.message ?? "";
  // Gemini SDK surfaces status inside a JSON-ish message string
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|network/i.test(msg);
}

/**
 * Pull a retry hint off an error. Gemini does NOT send a Retry-After header on
 * 429s — it buries the hint in the JSON error body, in two different shapes:
 *   "Please retry in 1.727719023s."
 *   "retryDelay": "1s"
 * Missing these meant backing off ~100ms when the API had asked for 1.7s,
 * which just burns another attempt against the same quota window.
 */
export function retryAfterMs(err: unknown): number | undefined {
  if (err instanceof UpstreamError && err.retryAfterMs != null) return err.retryAfterMs;
  const msg = (err as { message?: string })?.message ?? "";

  const patterns: RegExp[] = [
    /retry(?:-|\s)?after[":\s]+(\d+(?:\.\d+)?)/i, // standard header echoed in a body
    /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i, //     Gemini structured detail
    /retry in (\d+(?:\.\d+)?)\s*s/i, //              Gemini prose
  ];
  for (const re of patterns) {
    const m = re.exec(msg);
    if (m) return Math.ceil(Number(m[1]) * 1000);
  }
  return undefined;
}

export function parseRetryAfterHeader(res: { headers: { get(n: string): string | null } }): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (!Number.isNaN(secs)) return secs * 1000;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base delay in ms for the exponential curve. Default 500. */
  baseMs?: number;
  /** Ceiling for any single sleep. Default 20_000. */
  maxDelayMs?: number;
  /** Label used in log lines. */
  label?: string;
  /** Override the retryable predicate. */
  retryable?: (err: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exponential backoff with FULL jitter (sleep = random(0, exp)), which
 * decorrelates concurrent retries instead of synchronizing them into a
 * thundering herd — the failure mode of the fixed-delay ladders this replaces.
 * Honors Retry-After when the upstream sends one.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseMs = 500,
    maxDelayMs = 20_000,
    label = "call",
    retryable = isRetryable,
  } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === attempts || !retryable(e)) throw e;

      const hinted = retryAfterMs(e);
      const expo = Math.min(baseMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = hinted ?? Math.random() * expo;
      console.warn(
        `[RETRY] ${label} attempt ${attempt}/${attempts} failed (${(e as Error).message?.slice(0, 120)}), ` +
        `retrying in ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Run `fn` under a deadline. The signal is passed through so the underlying
 *  request is actually aborted, not just abandoned. */
export async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) throw new TimeoutError(ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

type BreakerState = "closed" | "open" | "half-open";

/**
 * Per-provider circuit breaker. Without one, a provider outage makes every
 * request pay the full timeout before failing — turning a dependency outage
 * into an outage of our own.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: BreakerState = "closed";
  private openedAt = 0;

  constructor(
    private readonly name: string,
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000
  ) {}

  get status(): { name: string; state: BreakerState; failures: number } {
    // Surface half-open once the cooldown has elapsed, without mutating here
    const state = this.state === "open" && Date.now() - this.openedAt >= this.cooldownMs
      ? "half-open"
      : this.state;
    return { name: this.name, state, failures: this.failures };
  }

  isOpen(): boolean {
    if (this.state !== "open") return false;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";
      console.warn(`[BREAKER] ${this.name} half-open — probing`);
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    if (this.state !== "closed") console.log(`[BREAKER] ${this.name} closed`);
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
      console.warn(`[BREAKER] ${this.name} OPEN after ${this.failures} failures`);
    }
  }

  /** Wrap a call: fail fast while open, and only count transient errors. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new UpstreamError(`${this.name} circuit open — failing fast`, 503);
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (e) {
      // A 400 is our bug, not the provider's — don't trip the breaker on it.
      if (isRetryable(e)) this.recordFailure();
      throw e;
    }
  }
}

export const breakers = {
  gemini: new CircuitBreaker("gemini"),
  ollama: new CircuitBreaker("ollama", 3, 15_000),
};
