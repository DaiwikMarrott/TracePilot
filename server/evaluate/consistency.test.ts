import { describe, expect, it } from "vitest";
import { defaultModelSettings } from "../../shared/defaults";
import { summarize } from "../../shared/summary";
import type { CaseResult, RunWithCases } from "../../shared/types";
import { consistencyReport, formatConsistency } from "./consistency";

const telemetry = { ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, requestId: null, messageId: null, servedModel: null, stopReason: null, attempts: 1 };

function c(fixtureId: string, passed: boolean | "error", urgency = "low"): CaseResult {
  return {
    runId: "r", index: 0, fixtureId, output: "", interrupted: false, attemptLog: [], startedAt: null, finishedAt: null, telemetry,
    status: passed === "error" ? "failed" : "completed",
    error: passed === "error" ? { kind: "rate_limit", message: "429" } : null,
    evaluation: passed === "error" ? null : { passed, checks: [], predicted: { category: "billing", urgency } },
  };
}

function run(version: number, cases: CaseResult[]): RunWithCases {
  return {
    id: `r${Math.random()}`, promptVersionId: version, promptSnapshot: { version, label: `L${version}`, systemPrompt: "", userTemplate: "" },
    modelSettings: defaultModelSettings(), fixtureSelection: "dev", fixtureSnapshot: [], fixtureHash: "h", status: "completed", statusReason: null,
    createdAt: "", startedAt: null, finishedAt: null, summary: summarize(cases), cases,
  };
}

describe("consistencyReport", () => {
  const report = consistencyReport([
    run(1, [c("T1", true), c("T2", false, "high")]),
    run(2, [c("T1", true), c("T2", true)]),
    run(1, [c("T1", true), c("T2", true, "low")]),
    run(1, [c("T1", "error"), c("T2", true, "low")]),
  ]);

  it("groups repetitions by prompt version and counts passes over evaluated repetitions", () => {
    expect(report.map((v) => [v.version, v.repetitions, v.passed, v.evaluated])).toEqual([
      [1, 3, 4, 5],
      [2, 1, 2, 2],
    ]);
  });

  it("flags cases whose outcome or labels changed, but not errors alone", () => {
    const [t1, t2] = report[0]!.cases;
    expect(t1).toMatchObject({ stable: true, outcomes: ["passed", "passed", "errored"], evaluated: 2 });
    expect(t2).toMatchObject({ stable: false, passed: 2, labels: { "billing/high": 1, "billing/low": 2 } });
  });

  it("formats a readable summary", () => {
    expect(formatConsistency(report)).toBe(
      [
        "v1 — L1: 4/5 evaluated repetitions passed (80%) over 3 runs",
        "  T2 varied: failed, passed, passed · labels billing/high ×1, billing/low ×2",
        "v2 — L2: 2/2 evaluated repetitions passed (100%) over 1 runs",
        "  every case gave the same outcome and labels in each repetition",
      ].join("\n"),
    );
  });
});
