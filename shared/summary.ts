import type { CaseResult, RunSummary } from "./types";

export type CaseOutcome = "passed" | "failed" | "errored" | "cancelled" | "unfinished";

/** Collapses execution status and evaluation into the bucket shown in the interface. */
export function caseOutcome(result: Pick<CaseResult, "status" | "evaluation">): CaseOutcome {
  switch (result.status) {
    case "completed":
      return result.evaluation?.passed ? "passed" : "failed";
    case "failed":
      return "errored";
    case "cancelled":
      return "cancelled";
    case "queued":
    case "running":
      return "unfinished";
  }
}

export function summarize(cases: Pick<CaseResult, "status" | "evaluation">[]): RunSummary {
  const summary: RunSummary = { total: cases.length, passed: 0, failed: 0, errored: 0, cancelled: 0, unfinished: 0 };
  for (const c of cases) summary[caseOutcome(c)] += 1;
  return summary;
}
