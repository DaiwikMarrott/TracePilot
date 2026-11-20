import { describe, expect, it } from "vitest";
import type { CaseResult, CaseTelemetry } from "./types";
import { mean, median, relativeChange, summarizeTelemetry } from "./stats";

const telemetry: CaseTelemetry = { ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, requestId: null, messageId: null, servedModel: null, stopReason: null, attempts: 1 };
const c = (status: CaseResult["status"], t: Partial<CaseTelemetry>): CaseResult => ({
  runId: "r", index: 0, fixtureId: "T", status, output: "", interrupted: false, evaluation: null, error: null, attemptLog: [], startedAt: null, finishedAt: null,
  telemetry: { ...telemetry, ...t },
});

describe("median and mean", () => {
  it("ignore unknown values but count them", () => {
    expect(median([3, null, 1, 2])).toEqual({ value: 2, known: 3, unknown: 1 });
    expect(median([4, 1, 3, 2])).toEqual({ value: 2.5, known: 4, unknown: 0 });
    expect(mean([10, null, 20])).toEqual({ value: 15, known: 2, unknown: 1 });
    expect(median([null])).toEqual({ value: null, known: 0, unknown: 1 });
  });
});

describe("summarizeTelemetry", () => {
  it("uses completed cases only, so truncated failures don't flatter latency", () => {
    const s = summarizeTelemetry([
      c("completed", { ttftMs: 800, durationMs: 1000, inputTokens: 100, outputTokens: 20 }),
      c("completed", { ttftMs: 1200, durationMs: 1400, inputTokens: 300, outputTokens: 40 }),
      c("failed", { ttftMs: 5, durationMs: 10, inputTokens: 1, outputTokens: 1 }),
      c("queued", {}),
    ]);
    expect(s.completed).toBe(2);
    expect(s.medianTtftMs.value).toBe(1000);
    expect(s.medianDurationMs.value).toBe(1200);
    expect(s.meanInputTokens.value).toBe(200);
    expect(s.meanOutputTokens.value).toBe(30);
  });
});

describe("relativeChange", () => {
  const m = (value: number | null, unknown = 0) => ({ value, known: value === null ? 0 : 1, unknown });
  it("states a change only when both sides are fully known", () => {
    expect(relativeChange(m(100), m(280))).toBeCloseTo(1.8);
    expect(relativeChange(m(100), m(50))).toBeCloseTo(-0.5);
    expect(relativeChange(m(100, 1), m(50))).toBeNull();
    expect(relativeChange(m(null), m(50))).toBeNull();
    expect(relativeChange(m(0), m(50))).toBeNull();
  });
});
