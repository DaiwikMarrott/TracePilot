import { caseOutcome, type CaseOutcome } from "../../shared/summary";
import type { RunWithCases } from "../../shared/types";

export interface CaseConsistency {
  fixtureId: string;
  /** Outcome in each repetition, in run order. */
  outcomes: CaseOutcome[];
  passed: number;
  /** Repetitions that produced an evaluated answer (passed or failed checks). */
  evaluated: number;
  /** Distinct predicted "category/urgency" labels and how often each appeared. */
  labels: Record<string, number>;
  /** True when every evaluated repetition had the same outcome and the same labels. */
  stable: boolean;
}

export interface VersionConsistency {
  version: number;
  label: string;
  repetitions: number;
  passed: number;
  evaluated: number;
  cases: CaseConsistency[];
}

/**
 * Groups repeated runs by prompt version and reports, per case, how often it
 * passed and whether the model's labels changed between repetitions. Errors,
 * cancellations and unfinished cases are not counted as evaluated: they say
 * nothing about the model's consistency.
 */
export function consistencyReport(runs: RunWithCases[]): VersionConsistency[] {
  const byVersion = new Map<number, RunWithCases[]>();
  for (const run of runs) {
    const list = byVersion.get(run.promptSnapshot.version) ?? [];
    list.push(run);
    byVersion.set(run.promptSnapshot.version, list);
  }
  return [...byVersion.entries()].map(([version, versionRuns]) => {
    const fixtureIds = [...new Set(versionRuns.flatMap((r) => r.cases.map((c) => c.fixtureId)))];
    const cases = fixtureIds.map((fixtureId): CaseConsistency => {
      const results = versionRuns.map((r) => r.cases.find((c) => c.fixtureId === fixtureId)).filter((c) => c !== undefined);
      const outcomes = results.map(caseOutcome);
      const labels: Record<string, number> = {};
      for (const c of results) {
        if (!c.evaluation) continue;
        const key = `${c.evaluation.predicted.category ?? "?"}/${c.evaluation.predicted.urgency ?? "?"}`;
        labels[key] = (labels[key] ?? 0) + 1;
      }
      const evaluatedOutcomes = outcomes.filter((o) => o === "passed" || o === "failed");
      return {
        fixtureId,
        outcomes,
        passed: outcomes.filter((o) => o === "passed").length,
        evaluated: evaluatedOutcomes.length,
        labels,
        stable: new Set(evaluatedOutcomes).size <= 1 && Object.keys(labels).length <= 1,
      };
    });
    return {
      version,
      label: versionRuns[0]!.promptSnapshot.label,
      repetitions: versionRuns.length,
      passed: cases.reduce((n, c) => n + c.passed, 0),
      evaluated: cases.reduce((n, c) => n + c.evaluated, 0),
      cases,
    };
  });
}

export function formatConsistency(report: VersionConsistency[]): string {
  const lines: string[] = [];
  for (const v of report) {
    const rate = v.evaluated ? ` (${Math.round((v.passed / v.evaluated) * 100)}%)` : "";
    lines.push(`v${v.version} — ${v.label}: ${v.passed}/${v.evaluated} evaluated repetitions passed${rate} over ${v.repetitions} runs`);
    const unstable = v.cases.filter((c) => !c.stable);
    if (unstable.length === 0) {
      lines.push("  every case gave the same outcome and labels in each repetition");
      continue;
    }
    for (const c of unstable) {
      const labels = Object.entries(c.labels)
        .map(([label, n]) => `${label} ×${n}`)
        .join(", ");
      lines.push(`  ${c.fixtureId} varied: ${c.outcomes.join(", ")}${labels ? ` · labels ${labels}` : ""}`);
    }
  }
  return lines.join("\n");
}
