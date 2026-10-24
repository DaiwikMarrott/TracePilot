import type { CaseOutcome } from "../../../shared/summary";
import type { RunStatus, RunSummary } from "../../../shared/types";

// Badges always pair color with a text label so state is never conveyed by color alone.
export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  passed: "passed",
  failed: "failed checks",
  errored: "error",
  cancelled: "cancelled",
  unfinished: "unfinished",
};

export function OutcomeBadge({
  outcome,
  interrupted,
  running,
}: {
  outcome: CaseOutcome;
  interrupted?: boolean;
  /** A case in progress is "unfinished" for scoring but should read as running while you watch it. */
  running?: boolean;
}) {
  return (
    <span className="badge-group">
      {running ? (
        <span className="badge badge-running">running</span>
      ) : (
        <span className={`badge badge-${outcome}`}>{OUTCOME_LABEL[outcome]}</span>
      )}
      {interrupted && <span className="badge badge-interrupted">interrupted</span>}
    </span>
  );
}

export function SummaryCounts({ summary }: { summary: RunSummary }) {
  return (
    <span className="counts">
      <span>
        <strong>{summary.passed}</strong> passed
      </span>
      <span>
        <strong>{summary.failed}</strong> failed
      </span>
      {summary.errored > 0 && (
        <span>
          <strong>{summary.errored}</strong> error
        </span>
      )}
      {summary.cancelled > 0 && (
        <span>
          <strong>{summary.cancelled}</strong> cancelled
        </span>
      )}
      {summary.unfinished > 0 && (
        <span>
          <strong>{summary.unfinished}</strong> unfinished
        </span>
      )}
      <span className="muted">of {summary.total}</span>
    </span>
  );
}
