/**
 * telemetry.ts
 * OpenTelemetry tracing for every AI call, exported to Langfuse via OTLP.
 *
 * Attribute names follow the OpenTelemetry GenAI semantic conventions. Those
 * are still pre-1.0 and can change between releases, so the names live in
 * GEN_AI below rather than being sprinkled through the codebase — when the spec
 * moves, one file changes and the vendor stays swappable (Langfuse and Phoenix
 * both ingest OTLP).
 *
 * Replaces six [METRIC] console lines that were unparseable strings with no
 * request id, so concurrent turns couldn't be untangled and background
 * setImmediate work couldn't be tied to the request that spawned it. Two were
 * actively misleading: the chat latency wrapped the liveness probe, classifier,
 * embedding, two RPCs and up to two Gemini calls in one number, and MoodScore
 * included its own retry sleeps (~180s for a retried score).
 *
 * Disabled unless OTEL_EXPORTER_OTLP_ENDPOINT is set — no-ops cleanly so local
 * dev and the existing deploy keep working untouched.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { config } from "../config.js";

/** GenAI semantic-convention attribute keys, pinned in one place. */
export const GEN_AI = {
  system: "gen_ai.system",
  operation: "gen_ai.operation.name",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  usageTotalTokens: "gen_ai.usage.total_tokens",
  toolName: "gen_ai.tool.name",
} as const;

const tracer = trace.getTracer("inner-archive", "1.0.0");

// ─── Request context ─────────────────────────────────────────────────────────

interface RequestContext {
  requestId: string;
  username?: string;
  sessionId?: string;
}

const store = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return store.run({ requestId: ctx.requestId ?? randomUUID(), ...ctx }, fn);
}

export function currentContext(): RequestContext | undefined {
  return store.getStore();
}

export function setContextField<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K]
): void {
  const ctx = store.getStore();
  if (ctx) ctx[key] = value;
}

// ─── Cost accounting ─────────────────────────────────────────────────────────

/** USD per 1M tokens. Free-tier usage still costs quota, and knowing the
 *  paid-equivalent spend is what makes a budget decision possible later. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-embedding-001": { input: 0.15, output: 0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ─── Span helpers ────────────────────────────────────────────────────────────

export interface LlmSpanAttrs {
  operation: string;
  model: string;
  system?: "gemini" | "ollama";
}

/** Usage as reported by the provider — previously never read anywhere. */
export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  responseModel?: string;
}

/**
 * Wrap an AI call in a span. `record` lets the callback report token usage
 * once the response is in hand.
 */
export async function withLlmSpan<T>(
  attrs: LlmSpanAttrs,
  fn: (record: (usage: UsageInfo) => void) => Promise<T>
): Promise<T> {
  const ctx = currentContext();
  return tracer.startActiveSpan(`${attrs.operation} ${attrs.model}`, async (span: Span) => {
    span.setAttribute(GEN_AI.system, attrs.system ?? "gemini");
    span.setAttribute(GEN_AI.operation, attrs.operation);
    span.setAttribute(GEN_AI.requestModel, attrs.model);
    if (ctx?.requestId) span.setAttribute("request.id", ctx.requestId);
    if (ctx?.username) span.setAttribute("user.id", ctx.username);
    if (ctx?.sessionId) span.setAttribute("session.id", ctx.sessionId);

    const record = (usage: UsageInfo) => {
      const input = usage.inputTokens ?? 0;
      const output = usage.outputTokens ?? 0;
      if (usage.inputTokens != null) span.setAttribute(GEN_AI.usageInputTokens, input);
      if (usage.outputTokens != null) span.setAttribute(GEN_AI.usageOutputTokens, output);
      if (usage.totalTokens != null) span.setAttribute(GEN_AI.usageTotalTokens, usage.totalTokens);
      if (usage.finishReason) span.setAttribute(GEN_AI.responseFinishReasons, [usage.finishReason]);
      if (usage.responseModel) span.setAttribute(GEN_AI.responseModel, usage.responseModel);
      const cost = estimateCostUsd(usage.responseModel ?? attrs.model, input, output);
      if (cost > 0) span.setAttribute("gen_ai.usage.cost_usd", cost);
    };

    try {
      const result = await fn(record);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Generic span for non-LLM work worth timing separately (retrieval, TTS). */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {}
): Promise<T> {
  const ctx = currentContext();
  return tracer.startActiveSpan(name, async (span: Span) => {
    for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
    if (ctx?.requestId) span.setAttribute("request.id", ctx.requestId);
    if (ctx?.username) span.setAttribute("user.id", ctx.username);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      span.recordException(e as Error);
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Pull usage off a Gemini SDK response. Shape-tolerant: the SDK has moved
 *  these fields before, and a telemetry read must never break a real call. */
export function usageFromGemini(response: unknown): UsageInfo {
  const r = response as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    modelVersion?: string;
    candidates?: { finishReason?: unknown }[];
  };
  return {
    inputTokens: r?.usageMetadata?.promptTokenCount,
    outputTokens: r?.usageMetadata?.candidatesTokenCount,
    totalTokens: r?.usageMetadata?.totalTokenCount,
    finishReason: r?.candidates?.[0]?.finishReason
      ? String(r.candidates[0].finishReason)
      : undefined,
    responseModel: r?.modelVersion,
  };
}

// ─── SDK bootstrap ───────────────────────────────────────────────────────────

let started = false;

/** Start the tracer. Call once, before anything else imports the AI layer. */
export async function initTelemetry(): Promise<void> {
  if (started || !config.otelEndpoint) return;
  started = true;
  try {
    const [{ NodeTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }] =
      await Promise.all([
        import("@opentelemetry/sdk-trace-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
      ]);

    const exporter = new OTLPTraceExporter({
      url: `${config.otelEndpoint.replace(/\/$/, "")}/v1/traces`,
      headers: config.otelHeaders,
    });

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        "service.name": "inner-archive-backend",
        "service.version": "1.0.0",
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
    console.log(`[TELEMETRY] tracing → ${config.otelEndpoint}`);
  } catch (e) {
    // Telemetry must never take the app down.
    console.warn("[TELEMETRY] disabled — init failed:", (e as Error).message);
  }
}
