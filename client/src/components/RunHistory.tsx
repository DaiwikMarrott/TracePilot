import { useState } from "react";
import type { Run } from "../../../shared/types";
import { RunStatusBadge, SummaryCounts } from "./badges";

interface Props {
  runs: Run[];
  selected: string[];
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onCompare: () => void;
}

const ALL = "all";
const providerLabel = (p: string) => ({ mock: "Mock", anthropic: "Claude API", google: "Gemini API" })[p] ?? p;

export function RunHistory({ runs, selected, onToggle, onOpen, onCompare }: Props) {
  const [a, b] = selected.map((id) => runs.find((r) => r.id === id));
  const comparable = a && b && a.fixtureHash === b.fixtureHash;
  const [provider, setProvider] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [version, setVersion] = useState(ALL);
  // Offer only values that occur, so a filter can never produce an empty list by construction.
  const providers = [...new Set(runs.map((r) => r.modelSettings.provider))].sort();
  const statuses = [...new Set(runs.map((r) => r.status))].sort();
  const versions = [...new Set(runs.map((r) => r.promptSnapshot.version))].sort((x, y) => x - y);
  const visible = runs.filter(
    (r) =>
      (provider === ALL || r.modelSettings.provider === provider) &&
      (status === ALL || r.status === status) &&
      (version === ALL || String(r.promptSnapshot.version) === version),
  );
  const hiddenSelected = selected.filter((id) => !visible.some((r) => r.id === id)).length;
  const filtered = visible.length !== runs.length;
  return (
    <section aria-labelledby="history-heading" className="panel">
      <div className="row spread">
        <h2 id="history-heading">Run history</h2>
        <div className="row">
          <span className="muted" aria-live="polite">
            {selected.length}/2 selected
            {hiddenSelected > 0 && ` (${hiddenSelected} hidden by filters)`}
            {a && b && !comparable && " — these runs used different fixture snapshots"}
          </span>
          <button type="button" onClick={onCompare} disabled={selected.length !== 2}>
            Compare selected
          </button>
        </div>
      </div>
      {runs.length > 0 && (
        <div className="row" role="group" aria-label="Filter runs">
          <label className="field inline">
            <span>Prompt</span>
            <select value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value={ALL}>All versions</option>
              {versions.map((v) => (
                <option key={v} value={String(v)}>
                  v{v}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value={ALL}>All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {providerLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value={ALL}>All statuses</option>
              {statuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </label>
          <span className="muted" role="status">
            {filtered ? `Showing ${visible.length} of ${runs.length} runs` : `${runs.length} runs`}
          </span>
        </div>
      )}
      {runs.length === 0 ? (
        <p className="muted">No runs yet. Start an evaluation to record one.</p>
      ) : visible.length === 0 ? (
        <p className="muted">No runs match these filters.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Recorded evaluation runs, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Compare</th>
                <th scope="col">Started</th>
                <th scope="col">Prompt</th>
                <th scope="col">Provider</th>
                <th scope="col">Fixtures</th>
                <th scope="col">Status</th>
                <th scope="col">Results</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((run) => {
                const isSelected = selected.includes(run.id);
                const label = `v${run.promptSnapshot.version} run from ${new Date(run.createdAt).toLocaleString()}`;
                return (
                  <tr key={run.id} aria-selected={isSelected}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!isSelected && selected.length >= 2}
                        onChange={() => onToggle(run.id)}
                        aria-label={`Select ${label} for comparison`}
                      />
                    </td>
                    <td>{new Date(run.createdAt).toLocaleString()}</td>
                    <td>
                      v{run.promptSnapshot.version} <span className="muted">{run.promptSnapshot.label}</span>
                    </td>
                    <td>
                      {run.modelSettings.provider === "mock" ? "mock" : `${run.modelSettings.provider} · ${run.modelSettings.model}`}
                      {run.modelSettings.provider === "mock" && run.modelSettings.mockScenario !== "none" && (
                        <span className="muted"> ({run.modelSettings.mockScenario})</span>
                      )}
                    </td>
                    <td>
                      {run.fixtureSelection} <span className="muted mono">#{run.fixtureHash.slice(0, 6)}</span>
                    </td>
                    <td>
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td>
                      <SummaryCounts summary={run.summary} />
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => onOpen(run.id)} aria-label={`Open details for ${label}`}>
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
