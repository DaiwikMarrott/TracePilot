import type { Run } from "../../../shared/types";
import { RunStatusBadge, SummaryCounts } from "./badges";

interface Props {
  runs: Run[];
  selected: string[];
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onCompare: () => void;
}

export function RunHistory({ runs, selected, onToggle, onOpen, onCompare }: Props) {
  const [a, b] = selected.map((id) => runs.find((r) => r.id === id));
  const comparable = a && b && a.fixtureHash === b.fixtureHash;
  return (
    <section aria-labelledby="history-heading" className="panel">
      <div className="row spread">
        <h2 id="history-heading">Run history</h2>
        <div className="row">
          <span className="muted" aria-live="polite">
            {selected.length}/2 selected
            {a && b && !comparable && " — these runs used different fixture snapshots"}
          </span>
          <button type="button" onClick={onCompare} disabled={selected.length !== 2}>
            Compare selected
          </button>
        </div>
      </div>
      {runs.length === 0 ? (
        <p className="muted">No runs yet. Start an evaluation to record one.</p>
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
              {runs.map((run) => {
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
                      {run.modelSettings.provider === "mock" ? "mock" : run.modelSettings.model}
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
