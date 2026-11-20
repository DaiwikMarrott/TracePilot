import { caseOutcome } from "../../shared/summary";
import type { RunWithCases } from "../../shared/types";

const COLUMNS = [
  "run_id",
  "prompt_version",
  "prompt_label",
  "provider",
  "model",
  "fixture_hash",
  "fixture_id",
  "split",
  "expected_category",
  "expected_urgency",
  "predicted_category",
  "predicted_urgency",
  "outcome",
  "interrupted",
  "failed_checks",
  "error_kind",
  "error_message",
  "ttft_ms",
  "duration_ms",
  "input_tokens",
  "output_tokens",
  "attempts",
  "request_id",
  "served_model",
  "stop_reason",
] as const;

type Cell = string | number | boolean | null | undefined;

/**
 * RFC 4180 quoting. Unknown values become empty cells, never 0. Text that a
 * spreadsheet would run as a formula (=, +, -, @) is prefixed with an
 * apostrophe, because error messages can echo text from a remote API.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per case, with the run's recorded inputs repeated so each row stands alone. */
export function runToCsv(run: RunWithCases): string {
  const fixtures = new Map(run.fixtureSnapshot.map((f) => [f.id, f]));
  const s = run.modelSettings;
  const rows = run.cases.map((c) => {
    const fixture = fixtures.get(c.fixtureId);
    const t = c.telemetry;
    const failed = c.evaluation?.checks.filter((x) => x.status === "failed").map((x) => x.name) ?? [];
    const row: Record<(typeof COLUMNS)[number], Cell> = {
      run_id: run.id,
      prompt_version: run.promptSnapshot.version,
      prompt_label: run.promptSnapshot.label,
      provider: s.provider,
      model: s.provider === "mock" ? null : s.model,
      fixture_hash: run.fixtureHash,
      fixture_id: c.fixtureId,
      split: fixture?.split,
      expected_category: fixture?.expected.category,
      expected_urgency: fixture?.expected.urgency,
      predicted_category: c.evaluation?.predicted.category,
      predicted_urgency: c.evaluation?.predicted.urgency,
      outcome: caseOutcome(c),
      interrupted: c.interrupted,
      failed_checks: failed.join(";"),
      error_kind: c.error?.kind,
      error_message: c.error?.message,
      ttft_ms: t.ttftMs === null ? null : Math.round(t.ttftMs),
      duration_ms: t.durationMs === null ? null : Math.round(t.durationMs),
      input_tokens: t.inputTokens,
      output_tokens: t.outputTokens,
      attempts: t.attempts,
      request_id: t.requestId,
      served_model: t.servedModel,
      stop_reason: t.stopReason,
    };
    return COLUMNS.map((col) => csvCell(row[col])).join(",");
  });
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
