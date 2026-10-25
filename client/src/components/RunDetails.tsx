import { useEffect, useRef, useState } from "react";
import { caseOutcome } from "../../../shared/summary";
import type { CaseResult, RunWithCases } from "../../../shared/types";
import { api, errorMessage } from "../api";
import { OutcomeBadge, RunStatusBadge, SummaryCounts } from "./badges";
import { CaseCard } from "./CaseCard";

const ms = (v: number | null) => (v === null ? "unknown" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const num = (v: number | null) => (v === null ? "unknown" : v.toLocaleString());

/** Sums values only when every one is known; otherwise says how many are missing. */
function total(values: (number | null)[]): string {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === values.length) return known.reduce((a, b) => a + b, 0).toLocaleString();
  const missing = values.length - known.length;
  return known.length === 0 ? "unknown" : `≥ ${known.reduce((a, b) => a + b, 0).toLocaleString()} (${missing} unknown)`;
}

function slowest(cases: CaseResult[]): CaseResult | null {
  return cases.reduce<CaseResult | null>(
    (worst, c) => (c.telemetry.durationMs !== null && (worst === null || c.telemetry.durationMs > worst.telemetry.durationMs!) ? c : worst),
    null,
  );
}

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
  const s = run.modelSettings;
  const executed = run.cases.filter((c) => c.telemetry.attempts > 0);
  const worst = slowest(executed);
  const retried = executed.filter((c) => c.telemetry.attempts > 1).length;

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

      <div className="compare-grid">
        <div className="stack">
          <h3>Recorded inputs</h3>
          <dl className="meta">
            <dt>Run ID</dt>
            <dd className="mono">{run.id}</dd>
            <dt>Prompt version</dt>
            <dd>
              v{run.promptSnapshot.version} (version id {run.promptVersionId})
            </dd>
            <dt>Provider</dt>
            <dd>{s.provider === "mock" ? `mock (scenario: ${s.mockScenario})` : s.provider === "anthropic" ? "Claude API" : "Gemini API"}</dd>
            {s.provider !== "mock" && (
              <>
                <dt>Model</dt>
                <dd className="mono">{s.model}</dd>
              </>
            )}
            {s.provider === "anthropic" && (
              <>
                <dt>Refusal fallback</dt>
                <dd>{s.refusalFallback ? "on" : "off"}</dd>
              </>
            )}
            <dt>Effort / max tokens</dt>
            <dd>
              {s.effort} / {s.maxTokens.toLocaleString()}
            </dd>
            <dt>Deadline / retries</dt>
            <dd>
              {ms(s.timeoutMs)} per attempt / up to {s.maxRetries} before output starts
            </dd>
            <dt>Fixtures</dt>
            <dd>
              {run.fixtureSelection} ({run.fixtureSnapshot.length}) · snapshot <span className="mono">{run.fixtureHash}</span>
            </dd>
          </dl>
        </div>
        <div className="stack">
          <h3>Timing and usage</h3>
          <dl className="meta">
            <dt>Created</dt>
            <dd>{new Date(run.createdAt).toLocaleString()}</dd>
            <dt>Wall time</dt>
            <dd>
              {run.startedAt && run.finishedAt
                ? ms(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
                : "not finished"}
            </dd>
            <dt>Input tokens</dt>
            <dd>{total(executed.map((c) => c.telemetry.inputTokens))}</dd>
            <dt>Output tokens</dt>
            <dd>{total(executed.map((c) => c.telemetry.outputTokens))}</dd>
            <dt>Slowest case</dt>
            <dd>{worst ? `${worst.fixtureId}: ${ms(worst.telemetry.durationMs)}` : "none"}</dd>
            <dt>Cases retried</dt>
            <dd>{retried}</dd>
          </dl>
        </div>
      </div>

      <details>
        <summary>Prompt text used by this run</summary>
        <div className="stack">
          <h4>System prompt</h4>
          <pre className="output">{run.promptSnapshot.systemPrompt}</pre>
          <h4>User message template</h4>
          <pre className="output">{run.promptSnapshot.userTemplate}</pre>
        </div>
      </details>

      <h3>Per-case telemetry</h3>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Timing, usage and identifiers for each case</caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Outcome</th>
              <th scope="col">First text</th>
              <th scope="col">Duration</th>
              <th scope="col">Tokens in / out</th>
              <th scope="col">Attempts</th>
              <th scope="col">Stop reason</th>
              <th scope="col">Request ID</th>
            </tr>
          </thead>
          <tbody>
            {run.cases.map((c) => (
              <tr key={c.index}>
                <th scope="row">{c.fixtureId}</th>
                <td>
                  <OutcomeBadge outcome={caseOutcome(c)} interrupted={c.interrupted} />
                </td>
                <td>{c.telemetry.attempts === 0 ? "not run" : ms(c.telemetry.ttftMs)}</td>
                <td>{c.telemetry.attempts === 0 ? "not run" : ms(c.telemetry.durationMs)}</td>
                <td>
                  {num(c.telemetry.inputTokens)} / {num(c.telemetry.outputTokens)}
                </td>
                <td>{c.telemetry.attempts}</td>
                <td>{c.telemetry.stopReason ?? "unknown"}</td>
                <td className="mono">{c.telemetry.requestId ?? "unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Cases</h3>
      <ol className="cases" aria-label="Case results">
        {run.cases.map((c) => (
          <li key={c.index} className="stack">
            <CaseCard result={c} fixture={fixtures.get(c.fixtureId)} headingLevel={4} />
            {c.attemptLog.length > 0 && (
              <details>
                <summary>
                  Attempt log for {c.fixtureId} ({c.attemptLog.length} attempt{c.attemptLog.length === 1 ? "" : "s"})
                </summary>
                <ol>
                  {c.attemptLog.map((a) => (
                    <li key={a.attempt}>
                      Attempt {a.attempt} at {new Date(a.startedAt).toLocaleTimeString()}: {a.outcome}
                      {a.errorKind && ` — ${a.errorKind}: ${a.message}`}
                      {a.requestId && <span className="mono"> [{a.requestId}]</span>}
                      {a.retryDelayMs !== undefined && ` — retried after ${ms(a.retryDelayMs)}`}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {c.telemetry.servedModel && s.provider !== "mock" && c.telemetry.servedModel !== s.model && (
              <p className="notice">
                Served by {c.telemetry.servedModel} instead of {s.model}
                {s.provider === "anthropic" ? " (server-side fallback)" : " (provider alias)"}.
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
