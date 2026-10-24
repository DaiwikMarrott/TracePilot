import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TICKETS } from "../../fixtures/tickets";
import { defaultModelSettings } from "../../shared/defaults";
import type { RunEvent } from "../../shared/types";
import { abortableSleep } from "../provider/mock";
import { ProviderError, type Provider, type ProviderResponse } from "../provider/types";
import { executeCase, retryDelay } from "./executeCase";

type Step = (onText: (t: string) => void, signal: AbortSignal) => Promise<ProviderResponse>;

/** A provider whose attempts follow a script, one step per call. */
function scripted(...steps: Step[]): Provider & { calls: number } {
  const p = {
    name: "mock" as const,
    calls: 0,
    stream: (_req: unknown, cb: { onText: (t: string) => void }, signal: AbortSignal) => steps[p.calls++]!(cb.onText, signal),
  };
  return p;
}

const ok =
  (text: string, usage: { input: number | null; output: number | null } = { input: 10, output: 5 }): Step =>
  async (onText) => {
    await new Promise((r) => setTimeout(r, 40)); // time to first token, on the fake clock
    onText(text);
    return { text, inputTokens: usage.input, outputTokens: usage.output, requestId: "req_ok", messageId: "msg_1", servedModel: "m", stopReason: "end_turn" };
  };
const fail = (kind: ProviderError["kind"], retryable: boolean, retryAfterMs: number | null = null): Step => async () => {
  throw new ProviderError(kind, `${kind} happened`, { retryable, requestId: `req_${kind}`, retryAfterMs });
};
const hang: Step = (_onText, signal) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ProviderError("cancelled", "aborted", { retryable: false }))));

const fixture = TICKETS[0]!;
const goodJson = JSON.stringify(fixture.expected);

function context(provider: Provider, overrides: Partial<ReturnType<typeof defaultModelSettings>> = {}, signal = new AbortController().signal) {
  const events: RunEvent[] = [];
  return {
    events,
    ctx: {
      runId: "run",
      index: 0,
      fixture,
      provider,
      request: { system: "s", user: "u", settings: { ...defaultModelSettings(), timeoutMs: 1000, maxRetries: 2, ...overrides } },
      signal,
      now: () => Date.now(),
      sleep: abortableSleep,
      emit: (e: RunEvent) => events.push(e),
      saveProgress: () => {},
    },
  };
}

/** Advances the fake clock in small steps until the case settles, so every timestamp is exact. */
async function drive<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.finally(() => (settled = true)).catch(() => {});
  while (!settled) await vi.advanceTimersByTimeAsync(10);
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-23T12:00:00Z") });
});
afterEach(() => vi.useRealTimers());

describe("executeCase", () => {
  it("records time to first text, duration, usage and identifiers", async () => {
    const { ctx } = context(scripted(ok(goodJson)));
    const result = await drive(executeCase(ctx));
    expect(result.status).toBe("completed");
    expect(result.evaluation!.passed).toBe(true);
    expect(result.telemetry).toMatchObject({ ttftMs: 40, durationMs: 40, inputTokens: 10, outputTokens: 5, requestId: "req_ok", attempts: 1 });
  });

  it("keeps unreported usage as unknown (null), not zero", async () => {
    const { ctx } = context(scripted(ok(goodJson, { input: null, output: null })));
    const result = await drive(executeCase(ctx));
    expect(result.telemetry.inputTokens).toBeNull();
    expect(result.telemetry.outputTokens).toBeNull();
  });

  it("retries a rate limit before output, honouring retry-after", async () => {
    const provider = scripted(fail("rate_limit", true, 1500), ok(goodJson));
    const { ctx, events } = context(provider);
    const result = await drive(executeCase(ctx));
    expect(provider.calls).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.telemetry.attempts).toBe(2);
    expect(result.telemetry.durationMs).toBe(1540);
    expect(result.attemptLog).toMatchObject([
      { attempt: 1, outcome: "error", errorKind: "rate_limit", retryDelayMs: 1500, requestId: "req_rate_limit" },
      { attempt: 2, outcome: "success", requestId: "req_ok" },
    ]);
    expect(events.find((e) => e.type === "case_retry")).toMatchObject({ attempt: 1, errorKind: "rate_limit", delayMs: 1500 });
  });

  it("uses bounded exponential backoff and gives up after maxRetries", async () => {
    expect([1, 2, 3, 10].map((a) => retryDelay(a, null))).toEqual([250, 500, 1000, 4000]);
    const provider = scripted(fail("overloaded", true), fail("overloaded", true), fail("overloaded", true), ok(goodJson));
    const { ctx } = context(provider, { maxRetries: 2 });
    const result = await drive(executeCase(ctx));
    expect(provider.calls).toBe(3);
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ kind: "overloaded", message: "overloaded happened (gave up after 3 attempts)" });
    expect(result.telemetry.durationMs).toBe(250 + 500);
  });

  it("does not retry non-retryable errors", async () => {
    const provider = scripted(fail("bad_request", false), ok(goodJson));
    const { ctx } = context(provider);
    const result = await drive(executeCase(ctx));
    expect(provider.calls).toBe(1);
    expect(result.error!.kind).toBe("bad_request");
  });

  it("enforces the per-attempt deadline and retries a timeout that produced no output", async () => {
    const provider = scripted(hang, ok(goodJson));
    const { ctx } = context(provider, { timeoutMs: 1000 });
    const result = await drive(executeCase(ctx));
    expect(result.attemptLog[0]).toMatchObject({ outcome: "error", errorKind: "timeout", message: "No complete response within 1000 ms" });
    expect(result.status).toBe("completed");
    expect(result.telemetry.durationMs).toBe(1000 + 250 + 40);
  });

  it("never retries after output began: keeps partial text and labels it interrupted", async () => {
    const provider = scripted(async (onText) => {
      onText('{"category": "bil');
      throw new ProviderError("overloaded", "Overloaded", { retryable: true, requestId: "req_mid" });
    }, ok(goodJson));
    const { ctx } = context(provider);
    const result = await drive(executeCase(ctx));
    expect(provider.calls).toBe(1);
    expect(result).toMatchObject({ status: "failed", interrupted: true, output: '{"category": "bil', evaluation: null });
    expect(result.error).toMatchObject({ kind: "stream_interrupted" });
    expect(result.error!.message).toMatch(/after 17 characters of output; not retried/);
    expect(result.telemetry.requestId).toBe("req_mid");
  });

  it("a deadline hit mid-stream is final and interrupted", async () => {
    const provider = scripted((onText, signal) => {
      onText("{");
      return hang(onText, signal);
    });
    const { ctx } = context(provider, { timeoutMs: 500 });
    const result = await drive(executeCase(ctx));
    expect(result).toMatchObject({ status: "failed", interrupted: true, output: "{" });
    expect(result.error!.kind).toBe("timeout");
    expect(result.telemetry.durationMs).toBe(500);
  });

  it("cancellation during backoff stops without another attempt", async () => {
    const controller = new AbortController();
    const provider = scripted(fail("rate_limit", true, 5000), ok(goodJson));
    const { ctx } = context(provider, {}, controller.signal);
    const pending = executeCase(ctx);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new Error("Stopped by user"));
    const result = await pending;
    expect(provider.calls).toBe(1);
    expect(result.status).toBe("cancelled");
    expect(result.error).toEqual({ kind: "cancelled", message: "Stopped by user" });
  });
});
