import { useEffect, useRef, useState } from "react";
import type { CaseResult, Fixture, RunWithCases } from "../../../shared/types";
import { caseOutcome } from "../../../shared/summary";
import { relativeChange, summarizeTelemetry, type Measured } from "../../../shared/stats";
import { api, errorMessage } from "../api";
import { RunStatusBadge, SummaryCounts } from "./badges";
import { CaseCard } from "./CaseCard";

type Change = "improved" | "regressed" | "same pass" | "same fail" | "incomplete";

function changeBetween(a: CaseResult | undefined, b: CaseResult | undefined): Change {
  if (!a || !b) return "incomplete";
  const pa = caseOutcome(a);
  const pb = caseOutcome(b);
  if (pa === "unfinished" || pb === "unfinished" || pa === "cancelled" || pb === "cancelled") return "incomplete";
  if (pa === "passed" && pb === "passed") return "same pass";
  if (pa !== "passed" && pb === "passed") return "improved";
  if (pa === "passed" && pb !== "passed") return "regressed";
  return "same fail";
}

export function CompareView({ a, b, onOpenRun }: { a: string; b: string; onOpenRun: (id: string) => void }) {
  const [runs, setRuns] = useState<[RunWithCases, RunWithCases] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    Promise.all([api.getRun(a), api.getRun(b)])
      .then(setRuns)
      .catch((err) => setError(errorMessage(err)));
  }, [a, b]);

  // Move focus to the new view's heading once it renders, for keyboard and screen-reader users.
  useEffect(() => {
    if (runs) headingRef.current?.focus();
  }, [runs]);

  if (error) return <p role="alert" className="error">Could not load runs: {error}</p>;
  if (!runs) return <p role="status">Loading comparison…</p>;

  const [runA, runB] = runs;
  const fixtures = new Map<string, Fixture>();
  for (const f of [...runA.fixtureSnapshot, ...runB.fixtureSnapshot]) if (!fixtures.has(f.id)) fixtures.set(f.id, f);
  const rows = [...fixtures.values()].map((fixture) => {
    const ca = runA.cases.find((c) => c.fixtureId === fixture.id);
    const cb = runB.cases.find((c) => c.fixtureId === fixture.id);
    return { fixture, ca, cb, change: changeBetween(ca, cb) };
  });
  const visible = onlyDifferences ? rows.filter((r) => r.change !== "same pass") : rows;
  const counts = rows.reduce<Record<Change, number>>(
    (acc, r) => ({ ...acc, [r.change]: acc[r.change] + 1 }),
    { improved: 0, regressed: 0, "same pass": 0, "same fail": 0, incomplete: 0 },
  );

  return (
    <section aria-labelledby="compare-heading" className="panel">
      <h2 id="compare-heading" tabIndex={-1} ref={headingRef}>
        Compare v{runA.promptSnapshot.version} and v{runB.promptSnapshot.version}
      </h2>
      {runA.fixtureHash !== runB.fixtureHash && (
        <p className="notice" role="note">
          These runs used different fixture snapshots ({runA.fixtureHash.slice(0, 6)} vs {runB.fixtureHash.slice(0, 6)}).
          Only cases with the same ticket ID are paired, and differences may come from the fixtures rather than the prompt.
        </p>
      )}
      <div className="compare-grid">
        {[runA, runB].map((run, i) => (
          <div key={run.id} className="stack">
            <h3>
              {i === 0 ? "A" : "B"}: v{run.promptSnapshot.version} — {run.promptSnapshot.label}
            </h3>
            <div className="row">
              <RunStatusBadge status={run.status} />
              <SummaryCounts summary={run.summary} />
            </div>
            <p className="muted">
              {run.modelSettings.provider === "mock" ? "mock provider" : `${run.modelSettings.provider} · ${run.modelSettings.model}`} · effort {run.modelSettings.effort} ·{" "}
              {new Date(run.createdAt).toLocaleString()}
            </p>
            <button type="button" className="link" onClick={() => onOpenRun(run.id)}>
              Open run {i === 0 ? "A" : "B"} details
            </button>
          </div>
        ))}
      </div>
      <TelemetryComparison runA={runA} runB={runB} />
      <div className="row spread">
        <p>
          <strong>{counts.improved}</strong> improved · <strong>{counts.regressed}</strong> regressed ·{" "}
          <strong>{counts["same pass"]}</strong> pass in both · <strong>{counts["same fail"]}</strong> fail in both
          {counts.incomplete > 0 && (
            <>
              {" "}
              · <strong>{counts.incomplete}</strong> incomplete in at least one run
            </>
          )}
        </p>
        <label className="field inline">
          <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
          <span>Hide cases that pass in both</span>
        </label>
      </div>
      <ol className="cases" aria-label="Paired cases">
        {visible.map(({ fixture, ca, cb, change }) => (
          <li key={fixture.id} className="stack">
            <h3>
              {fixture.id} · {fixture.ticket.subject} <span className={`badge badge-${changeClass(change)}`}>{change}</span>
            </h3>
            <div className="compare-grid">
              {[ca, cb].map((c, i) =>
                c ? (
                  <CaseCard key={i} result={c} headingLevel={4} title={`Run ${i === 0 ? "A" : "B"} (v${runs[i]!.promptSnapshot.version})`} />
                ) : (
                  <p key={i} className="muted">
                    Not in run {i === 0 ? "A" : "B"}.
                  </p>
                ),
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function changeClass(change: Change) {
  return { improved: "passed", regressed: "failed", "same pass": "completed", "same fail": "errored", incomplete: "cancelled" }[change];
}

const formatMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const formatTokens = (v: number) => Math.round(v).toLocaleString();

function formatMeasured(m: Measured, format: (v: number) => string): string {
  if (m.value === null) return "unknown";
  return m.unknown > 0 ? `${format(m.value)} (${m.unknown} unknown)` : format(m.value);
}

function formatChange(a: Measured, b: Measured): string {
  const change = relativeChange(a, b);
  if (change === null) return "—";
  const pct = Math.round(change * 100);
  return pct === 0 ? "no change" : `${pct > 0 ? "+" : ""}${pct}%`;
}

function TelemetryComparison({ runA, runB }: { runA: RunWithCases; runB: RunWithCases }) {
  const a = summarizeTelemetry(runA.cases);
  const b = summarizeTelemetry(runB.cases);
  const rows: [string, Measured, Measured, (v: number) => string][] = [
    ["Median time to first text", a.medianTtftMs, b.medianTtftMs, formatMs],
    ["Median case duration", a.medianDurationMs, b.medianDurationMs, formatMs],
    ["Mean input tokens per case", a.meanInputTokens, b.meanInputTokens, formatTokens],
    ["Mean output tokens per case", a.meanOutputTokens, b.meanOutputTokens, formatTokens],
  ];
  return (
    <div className="table-wrap">
      <table>
        <caption>
          Latency and usage over completed cases (A: {a.completed}, B: {b.completed}). A change is shown only when both
          runs reported every value.
        </caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">B vs A</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, ma, mb, format]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{formatMeasured(ma, format)}</td>
              <td>{formatMeasured(mb, format)}</td>
              <td>{formatChange(ma, mb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
