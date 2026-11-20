import type { CaseResult } from "./types";

/** A statistic over values some of which may be unknown (null). */
export interface Measured {
  /** Null when no value is known. */
  value: number | null;
  /** How many cases contributed a known value. */
  known: number;
  /** How many cases had no value. */
  unknown: number;
}

export function median(values: (number | null)[]): Measured {
  const known = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const unknown = values.length - known.length;
  if (known.length === 0) return { value: null, known: 0, unknown };
  const mid = Math.floor(known.length / 2);
  const value = known.length % 2 ? known[mid]! : (known[mid - 1]! + known[mid]!) / 2;
  return { value, known: known.length, unknown };
}

export function mean(values: (number | null)[]): Measured {
  const known = values.filter((v): v is number => v !== null);
  const unknown = values.length - known.length;
  if (known.length === 0) return { value: null, known: 0, unknown };
  return { value: known.reduce((a, b) => a + b, 0) / known.length, known: known.length, unknown };
}

export interface RunTelemetrySummary {
  /** Cases that completed (whatever their evaluation), the basis for every figure below. */
  completed: number;
  medianTtftMs: Measured;
  medianDurationMs: Measured;
  meanInputTokens: Measured;
  meanOutputTokens: Measured;
}

/**
 * Per-case latency and usage for runs being compared. Only completed cases
 * count: failed and cancelled cases have truncated timings that would make a
 * run look faster than it is. Means per case, not totals, so runs with
 * different numbers of completed cases stay comparable.
 */
export function summarizeTelemetry(cases: CaseResult[]): RunTelemetrySummary {
  const done = cases.filter((c) => c.status === "completed");
  return {
    completed: done.length,
    medianTtftMs: median(done.map((c) => c.telemetry.ttftMs)),
    medianDurationMs: median(done.map((c) => c.telemetry.durationMs)),
    meanInputTokens: mean(done.map((c) => c.telemetry.inputTokens)),
    meanOutputTokens: mean(done.map((c) => c.telemetry.outputTokens)),
  };
}

/**
 * Relative change from a to b, or null when it can't be stated honestly:
 * either side unknown or partly unknown, or a zero baseline.
 */
export function relativeChange(a: Measured, b: Measured): number | null {
  if (a.value === null || b.value === null || a.unknown > 0 || b.unknown > 0 || a.value === 0) return null;
  return (b.value - a.value) / a.value;
}
