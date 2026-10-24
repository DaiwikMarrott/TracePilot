import { useEffect, useRef, useState } from "react";
import type { RunWithCases } from "../../../shared/types";
import { api, errorMessage } from "../api";
import { RunStatusBadge, SummaryCounts } from "./badges";
import { CaseCard } from "./CaseCard";

export function RunDetails({ id }: { id: string }) {
  const [run, setRun] = useState<RunWithCases | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api
      .getRun(id)
      .then(setRun)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  useEffect(() => {
    if (run) headingRef.current?.focus();
  }, [run]);

  if (error) return <p role="alert" className="error">Could not load run: {error}</p>;
  if (!run) return <p role="status">Loading run…</p>;
  const fixtures = new Map(run.fixtureSnapshot.map((f) => [f.id, f]));

  return (
    <section aria-labelledby="run-details-heading" className="panel">
      <h2 id="run-details-heading" tabIndex={-1} ref={headingRef}>
        Run details: v{run.promptSnapshot.version} — {run.promptSnapshot.label}
      </h2>
      <div className="row">
        <RunStatusBadge status={run.status} />
        <SummaryCounts summary={run.summary} />
        {run.statusReason && <span className="muted">{run.statusReason}</span>}
      </div>
      <ol className="cases" aria-label="Case results">
        {run.cases.map((c) => (
          <li key={c.index}>
            <CaseCard result={c} fixture={fixtures.get(c.fixtureId)} />
          </li>
        ))}
      </ol>
    </section>
  );
}
