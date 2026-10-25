import { useState } from "react";
import { defaultModelSettings } from "../../../shared/defaults";
import { EFFORTS, MOCK_SCENARIOS } from "../../../shared/types";
import type { Effort, Fixture, FixtureSelection, HealthResponse, MockScenario, ModelSettings, PromptVersion, ProviderName } from "../../../shared/types";
import { api, errorMessage } from "../api";
import { useRunStream } from "../hooks/useRunStream";
import { RunStatusBadge, SummaryCounts } from "./badges";
import { CaseCard } from "./CaseCard";

const SCENARIO_LABEL: Record<MockScenario, string> = {
  none: "None",
  slow: "Slow stream (to try Stop)",
  rate_limit_once: "Rate limit on first attempt",
  interrupt_stream: "Interrupt every other stream",
  malformed: "Malformed JSON",
  timeout: "First attempt hangs (deadline)",
};

interface Props {
  health: HealthResponse | null;
  prompt: PromptVersion | null;
  fixtures: Fixture[];
  onRunFinished: () => void;
  onOpenRun: (id: string) => void;
}

export function RunPanel({ health, prompt, fixtures, onRunFinished, onOpenRun }: Props) {
  const [settings, setSettings] = useState<ModelSettings>(() => defaultModelSettings(health?.providers.anthropic.defaultModel));
  const [selection, setSelection] = useState<FixtureSelection>("dev");
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const live = useRunStream(runId, () => {
    setStopping(false);
    onRunFinished();
  });

  const run = live.run;
  const inProgress = run !== null && (run.status === "queued" || run.status === "running");
  const set = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  // Each live provider has its own default model; switching resets the model field to it.
  const chooseProvider = (provider: ProviderName) =>
    setSettings((s) => ({
      ...s,
      provider,
      model: provider === "mock" || !health ? s.model : health.providers[provider].defaultModel,
    }));
  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
  const done = run ? run.cases.filter((c) => c.status !== "queued" && c.status !== "running").length : 0;

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt) return;
    setError(null);
    try {
      const created = await api.createRun({ promptVersionId: prompt.id, fixtureSelection: selection, modelSettings: settings });
      setRunId(created.id);
      onRunFinished(); // refresh history so the queued run appears
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function stop() {
    if (!runId) return;
    setStopping(true);
    try {
      await api.cancelRun(runId);
    } catch (err) {
      setError(errorMessage(err));
      setStopping(false);
    }
  }

  return (
    <section aria-labelledby="run-heading" className="panel">
      <h2 id="run-heading">Evaluate</h2>
      <form onSubmit={start} className="stack">
        <fieldset className="grid-fields" disabled={inProgress}>
          <legend className="visually-hidden">Model settings</legend>
          <label className="field">
            <span>Provider</span>
            <select value={settings.provider} onChange={(e) => chooseProvider(e.target.value as ProviderName)}>
              <option value="mock">Mock (no API key)</option>
              <option value="anthropic" disabled={!health?.providers.anthropic.available}>
                Claude API{health?.providers.anthropic.available ? "" : " — set ANTHROPIC_API_KEY"}
              </option>
              <option value="google" disabled={!health?.providers.google.available}>
                Gemini API (dev stand-in){health?.providers.google.available ? "" : " — set GEMINI_API_KEY"}
              </option>
            </select>
          </label>
          <label className="field">
            <span>Fixtures</span>
            <select value={selection} onChange={(e) => setSelection(e.target.value as FixtureSelection)}>
              <option value="dev">Development set (8)</option>
              <option value="holdout">Final holdout (4)</option>
              <option value="all">All (12)</option>
            </select>
          </label>
          {settings.provider === "mock" ? (
            <label className="field">
              <span>Failure simulation</span>
              <select value={settings.mockScenario} onChange={(e) => set("mockScenario", e.target.value as MockScenario)}>
                {MOCK_SCENARIOS.map((s) => (
                  <option key={s} value={s}>
                    {SCENARIO_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Model</span>
              <input value={settings.model} onChange={(e) => set("model", e.target.value)} required />
            </label>
          )}
          <label className="field">
            <span>Effort / thinking level</span>
            <select value={settings.effort} onChange={(e) => set("effort", e.target.value as Effort)}>
              {EFFORTS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Max tokens</span>
            <input type="number" min={16} max={64000} value={settings.maxTokens} onChange={(e) => set("maxTokens", Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Deadline per attempt (ms)</span>
            <input type="number" min={100} step={100} value={settings.timeoutMs} onChange={(e) => set("timeoutMs", Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Max retries</span>
            <input type="number" min={0} max={5} value={settings.maxRetries} onChange={(e) => set("maxRetries", Number(e.target.value))} />
          </label>
          {settings.provider === "anthropic" && (
            <label className="field inline">
              <input type="checkbox" checked={settings.refusalFallback} onChange={(e) => set("refusalFallback", e.target.checked)} />
              <span>Server-side refusal fallback</span>
            </label>
          )}
        </fieldset>
        <div className="row">
          <button type="submit" disabled={!prompt || inProgress}>
            Start evaluation{prompt ? ` of v${prompt.version}` : ""}
          </button>
          <button type="button" className="danger" onClick={stop} disabled={!inProgress || stopping}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>

      <div role="status" aria-live="polite" className="row">
        {run ? (
          <>
            <RunStatusBadge status={run.status} />
            <span>
              {inProgress ? `Case ${Math.min(done + 1, run.cases.length)} of ${run.cases.length}` : `Run ${run.status}`}
              {run.statusReason && ` — ${run.statusReason}`}
            </span>
            {!inProgress && <SummaryCounts summary={run.summary} />}
            {!inProgress && (
              <button type="button" className="link" onClick={() => onOpenRun(run.id)}>
                Open run details
              </button>
            )}
          </>
        ) : (
          <span className="muted">No evaluation running.</span>
        )}
        {live.notice && live.notice !== run?.statusReason && <span className="muted">{live.notice}</span>}
        {live.connection === "error" && <span className="error">Lost connection to the server.</span>}
      </div>

      {run && (
        <ol className="cases" aria-label="Case results">
          {run.cases.map((c) => (
            <li key={c.index}>
              <CaseCard result={c} fixture={fixtureById.get(c.fixtureId)} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
