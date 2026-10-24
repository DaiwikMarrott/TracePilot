import { useCallback, useEffect, useState } from "react";
import type { CreatePromptVersionRequest, Fixture, HealthResponse, PromptVersion, Run } from "../../shared/types";
import { api, errorMessage } from "./api";
import { PromptEditor } from "./components/PromptEditor";
import { RunHistory } from "./components/RunHistory";
import { RunPanel } from "./components/RunPanel";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshRuns = useCallback(() => api.listRuns().then(setRuns), []);

  useEffect(() => {
    Promise.all([api.health(), api.listPrompts(), api.listRuns(), api.fixtures()])
      .then(([h, v, r, f]) => {
        setFixtures(f);
        setHealth(h);
        setVersions(v);
        setSelectedVersionId(v.at(-1)?.id ?? null);
        setRuns(r);
      })
      .catch((err) => setLoadError(`The API server is not reachable (${errorMessage(err)}). Start it with npm run dev.`));
  }, []);

  async function savePrompt(input: CreatePromptVersionRequest) {
    const created = await api.createPrompt(input);
    setVersions((vs) => [...vs, created]);
    return created;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>TracePilot</h1>
        <p role="status" className="muted">
          {loadError ??
            (health
              ? `Server online · live mode ${health.liveAvailable ? `available (${health.defaultModel})` : "unavailable — mock only"}`
              : "Connecting…")}
        </p>
      </header>
      <main className="layout two-col">
        <PromptEditor
          versions={versions}
          selectedId={selectedVersionId}
          onSelect={setSelectedVersionId}
          onSave={savePrompt}
        />
        {health && (
          <RunPanel
            health={health}
            prompt={versions.find((v) => v.id === selectedVersionId) ?? null}
            fixtures={fixtures}
            onRunFinished={() => void refreshRuns()}
          />
        )}
        <RunHistory
          runs={runs}
          selected={compareIds}
          onToggle={(id) => setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
          onOpen={() => void refreshRuns()}
          onCompare={() => {}}
        />
      </main>
    </div>
  );
}
