import type { CaseResult, Fixture, RunEvent } from "../../shared/types";
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

export async function executeCase(ctx: CaseContext): Promise<CaseResult> {
  const startedAt = ctx.now();
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
      attempts: 1,
    },
    error: null,
    attemptLog: [],
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
  };
  ctx.saveProgress(result);
  ctx.emit({ type: "case_status", runId: ctx.runId, index: ctx.index, status: "running" });

  try {
    const response = await ctx.provider.stream(
      ctx.request,
      {
        onText: (text) => {
          result.output += text;
          ctx.emit({ type: "case_delta", runId: ctx.runId, index: ctx.index, text });
        },
      },
      ctx.signal,
    );
    result.status = "completed";
    result.output = response.text;
    Object.assign(result.telemetry, {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      requestId: response.requestId,
      messageId: response.messageId,
      servedModel: response.servedModel,
      stopReason: response.stopReason,
    });
  } catch (err) {
    const error =
      err instanceof ProviderError ? err : new ProviderError("unknown", String(err), { retryable: false });
    result.status = ctx.signal.aborted ? "cancelled" : "failed";
    result.error = { kind: ctx.signal.aborted ? "cancelled" : error.kind, message: error.message };
    result.telemetry.requestId = error.requestId;
  }

  const finishedAt = ctx.now();
  result.finishedAt = new Date(finishedAt).toISOString();
  result.telemetry.durationMs = finishedAt - startedAt;
  return result;
}
