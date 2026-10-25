import type { AttemptRecord, CaseResult, ErrorKind, Fixture, RunEvent } from "../../shared/types";
import { evaluateResponse } from "../evaluate/evaluate";
import type { Sleep } from "../provider/mock";
import { ProviderError, type Provider, type ProviderRequest } from "../provider/types";

export interface CaseContext {
  runId: string;
  index: number;
  fixture: Fixture;
  provider: Provider;
  request: ProviderRequest;
  /** Aborts when the run is cancelled (Stop button or client disconnect). */
  signal: AbortSignal;
  now: () => number;
  sleep: Sleep;
  emit: (event: RunEvent) => void;
  saveProgress: (result: CaseResult) => void;
}

const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4_000;

// A server-provided delay is the best signal available (Gemini's free tier asks
// for ~55 s), so honour it up to a generous cap rather than retrying too early.
const MAX_RETRY_AFTER_MS = 120_000;

/**
 * Exponential backoff without jitter so runs and tests are reproducible. A
 * server-requested delay is honoured but never undercuts the backoff: Gemini
 * has been seen to send `retryDelay: 0s` while still rate limiting.
 */
export function retryDelay(attempt: number, retryAfterMs: number | null): number {
  const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  if (retryAfterMs !== null) return Math.min(Math.max(retryAfterMs, backoff), MAX_RETRY_AFTER_MS);
  return backoff;
}

class DeadlineExceeded extends Error {}

/**
 * Executes one fixture with bounded retries.
 *
 * Retry policy: an attempt is retried only if its failure is retryable AND
 * no response text has been received. Once output has started, a failure is
 * final: the partial text is kept and the case is labelled interrupted, so a
 * retry can never silently replace what the developer already saw.
 */
export async function executeCase(ctx: CaseContext): Promise<CaseResult> {
  const { settings } = ctx.request;
  const caseStart = ctx.now();
  const result: CaseResult = {
    runId: ctx.runId,
    index: ctx.index,
    fixtureId: ctx.fixture.id,
    status: "running",
    output: "",
    interrupted: false,
    evaluation: null,
    telemetry: {
      ttftMs: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      requestId: null,
      messageId: null,
      servedModel: null,
      stopReason: null,
      attempts: 0,
    },
    error: null,
    attemptLog: [],
    startedAt: new Date(caseStart).toISOString(),
    finishedAt: null,
  };
  ctx.saveProgress(result);
  ctx.emit({ type: "case_status", runId: ctx.runId, index: ctx.index, status: "running" });

  const finish = (status: CaseResult["status"], error: CaseResult["error"] = null) => {
    const end = ctx.now();
    result.status = status;
    result.error = error;
    result.finishedAt = new Date(end).toISOString();
    result.telemetry.durationMs = end - caseStart;
    return result;
  };

  for (let attempt = 1; attempt <= settings.maxRetries + 1; attempt++) {
    if (ctx.signal.aborted) return finish("cancelled", { kind: "cancelled", message: abortMessage(ctx.signal) });

    result.telemetry.attempts = attempt;
    const attemptStart = ctx.now();
    const record: AttemptRecord = { attempt, startedAt: new Date(attemptStart).toISOString(), outcome: "success" };
    result.attemptLog.push(record);

    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DeadlineExceeded(`No complete response within ${settings.timeoutMs} ms`)),
      settings.timeoutMs,
    );
    const signal = AbortSignal.any([ctx.signal, deadline.signal]);
    let firstTextAt: number | null = null;

    try {
      const response = await ctx.provider.stream(
        { ...ctx.request, attempt },
        {
          onText: (text) => {
            if (firstTextAt === null) firstTextAt = ctx.now();
            result.output += text;
            ctx.emit({ type: "case_delta", runId: ctx.runId, index: ctx.index, text });
          },
        },
        signal,
      );
      record.requestId = response.requestId;
      // Trust the assembled final message over concatenated deltas.
      result.output = response.text;
      result.telemetry = {
        ...result.telemetry,
        ttftMs: firstTextAt === null ? null : firstTextAt - attemptStart,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        requestId: response.requestId,
        messageId: response.messageId,
        servedModel: response.servedModel,
        stopReason: response.stopReason,
      };
      result.evaluation = evaluateResponse(response, ctx.fixture.expected);
      return finish("completed");
    } catch (err) {
      const failure = classify(err, ctx.signal, deadline.signal);
      record.outcome = "error";
      record.errorKind = failure.kind;
      record.message = failure.message;
      record.requestId = failure.requestId;
      result.telemetry.requestId = failure.requestId ?? result.telemetry.requestId;
      if (firstTextAt !== null) result.telemetry.ttftMs = firstTextAt - attemptStart;

      if (failure.kind === "cancelled") {
        return finish("cancelled", { kind: "cancelled", message: abortMessage(ctx.signal) });
      }
      if (result.output.length > 0) {
        result.interrupted = true;
        return finish("failed", {
          kind: failure.kind === "timeout" ? "timeout" : "stream_interrupted",
          message: `${failure.message} (after ${result.output.length} characters of output; not retried)`,
        });
      }
      if (failure.retryable && failure.retryAfterMs !== null && failure.retryAfterMs > MAX_RETRY_AFTER_MS) {
        // e.g. a daily quota: retrying sooner than the server asks is guaranteed to fail.
        const minutes = Math.round(failure.retryAfterMs / 60_000);
        return finish("failed", {
          kind: failure.kind,
          message: `${failure.message} (server asked to wait ${minutes} min, longer than the ${MAX_RETRY_AFTER_MS / 1000} s retry limit; not retried)`,
        });
      }
      if (!failure.retryable || attempt > settings.maxRetries) {
        const suffix = failure.retryable && settings.maxRetries > 0 ? ` (gave up after ${attempt} attempts)` : "";
        return finish("failed", { kind: failure.kind, message: failure.message + suffix });
      }

      const delayMs = retryDelay(attempt, failure.retryAfterMs);
      record.retryDelayMs = delayMs;
      // Persist the failed attempt now, so a long backoff is visible to anyone not on the live stream.
      ctx.saveProgress(result);
      ctx.emit({ type: "case_retry", runId: ctx.runId, index: ctx.index, attempt, errorKind: failure.kind, delayMs });
      try {
        await ctx.sleep(delayMs, ctx.signal);
      } catch {
        return finish("cancelled", { kind: "cancelled", message: abortMessage(ctx.signal) });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable: the loop always returns.
  return finish("failed", { kind: "unknown", message: "Retry loop exited unexpectedly" });
}

function classify(
  err: unknown,
  runSignal: AbortSignal,
  deadlineSignal: AbortSignal,
): { kind: ErrorKind; message: string; retryable: boolean; requestId: string | null; retryAfterMs: number | null } {
  const providerError = err instanceof ProviderError ? err : null;
  const requestId = providerError?.requestId ?? null;
  if (runSignal.aborted) {
    return { kind: "cancelled", message: abortMessage(runSignal), retryable: false, requestId, retryAfterMs: null };
  }
  if (deadlineSignal.aborted) {
    const reason = deadlineSignal.reason as Error;
    return { kind: "timeout", message: reason.message, retryable: true, requestId, retryAfterMs: null };
  }
  if (providerError) {
    return {
      kind: providerError.kind,
      message: providerError.message,
      retryable: providerError.retryable,
      requestId,
      retryAfterMs: providerError.retryAfterMs,
    };
  }
  return { kind: "unknown", message: err instanceof Error ? err.message : String(err), retryable: false, requestId, retryAfterMs: null };
}

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason.message : "Cancelled";
}
