import type { CaseResult, Fixture } from "../../../shared/types";
import { caseOutcome } from "../../../shared/summary";
import { OutcomeBadge } from "./badges";

export function CaseCard({ result, fixture, headingLevel = 3 }: { result: CaseResult; fixture?: Fixture; headingLevel?: 3 | 4 }) {
  const Heading = `h${headingLevel}` as const;
  const outcome = caseOutcome(result);
  return (
    <article className="case" aria-label={`Case ${result.fixtureId}: ${outcome}`}>
      <div className="row spread">
        <Heading>
          {result.fixtureId}
          {fixture && <span className="muted"> · {fixture.ticket.subject}</span>}
        </Heading>
        <OutcomeBadge outcome={outcome} interrupted={result.interrupted} />
      </div>
      {fixture && (
        <p className="muted">
          Expected: {fixture.expected.category} / {fixture.expected.urgency}
        </p>
      )}
      {(result.output || result.status === "running") && (
        <pre className="output" aria-label={`Response for ${result.fixtureId}`}>
          {result.output || "…"}
        </pre>
      )}
      {result.error && (
        <p className={result.status === "cancelled" ? "muted" : "error"}>
          {result.status === "cancelled" ? "Cancelled" : `Error (${result.error.kind.replace("_", " ")})`}: {result.error.message}
          {result.interrupted && " — partial output above was preserved."}
        </p>
      )}
      {result.evaluation && (
        <ul className="checks" aria-label={`Checks for ${result.fixtureId}`}>
          {result.evaluation.checks.map((check) => (
            <li key={check.name} className={`check-${check.status}`}>
              <span aria-hidden="true">{check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "–"}</span>{" "}
              <strong>{check.name.replace("_", " ")}</strong> {check.status}
              {check.status !== "passed" && `: ${check.detail}`}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
