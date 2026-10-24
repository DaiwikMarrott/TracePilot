// Runs prompt versions against a fixture split from the command line and
// prints a report. Runs are recorded in the same database the interface
// uses, so they can be inspected and compared there afterwards.
//
//   npm run eval -- --provider anthropic --split holdout --versions 1,2
import { parseArgs } from "node:util";
import { SEED_PROMPTS } from "../../fixtures/prompts";
import { defaultModelSettings } from "../../shared/defaults";
import { caseOutcome } from "../../shared/summary";
import type { FixtureSelection, ProviderName } from "../../shared/types";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { Repository } from "../db/repository";
import { ClaudeProvider } from "../provider/claude";
import { MockProvider } from "../provider/mock";
import { selectFixtures } from "../routes/runs";
import { RunManager } from "../runner/runManager";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "mock" },
    split: { type: "string", default: "holdout" },
    versions: { type: "string", default: "1,2" },
    model: { type: "string" },
  },
});

const config = loadConfig();
const provider = values.provider as ProviderName;
if (provider === "anthropic" && !config.apiKey) {
  console.error("Live evaluation needs ANTHROPIC_API_KEY (in .env or the environment).");
  process.exit(1);
}

const repo = new Repository(openDatabase(config.dbPath));
repo.seedPromptVersions(SEED_PROMPTS);
const manager = new RunManager({
  repo,
  providers: {
    mock: new MockProvider(),
    ...(config.apiKey ? { anthropic: new ClaudeProvider({ apiKey: config.apiKey }) } : {}),
  },
});

const fixtures = selectFixtures(values.split as FixtureSelection);
const settings = { ...defaultModelSettings(values.model ?? config.defaultModel), provider };
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
  const id = manager.activeRunId();
  if (id) manager.cancel(id, "Interrupted from the command line");
});

for (const version of values.versions.split(",").map(Number)) {
  if (interrupted) break;
  const prompt = repo.listPromptVersions().find((v) => v.version === version);
  if (!prompt) {
    console.error(`No prompt version v${version}`);
    continue;
  }
  const created = repo.createRun({ prompt, modelSettings: settings, fixtureSelection: values.split as FixtureSelection, fixtures });
  await manager.start(created.id);
  const run = repo.getRunWithCases(created.id)!;
  const label = provider === "mock" ? "mock provider" : settings.model;
  console.log(`\nv${version} — ${prompt.label} (${label}, ${values.split}, run ${run.id})`);
  console.log(`status: ${run.status}${run.statusReason ? ` (${run.statusReason})` : ""}`);
  const s = run.summary;
  console.log(`passed ${s.passed}/${s.total} · failed ${s.failed} · error ${s.errored} · cancelled ${s.cancelled} · unfinished ${s.unfinished}`);
  for (const c of run.cases) {
    const t = c.telemetry;
    const failed = c.evaluation?.checks.filter((x) => x.status === "failed").map((x) => `${x.name}: ${x.detail}`) ?? [];
    const why = c.error ? `${c.error.kind}: ${c.error.message}` : failed.join(" | ");
    const tokens = `${t.inputTokens ?? "?"}/${t.outputTokens ?? "?"} tok`;
    const timing = `ttft ${t.ttftMs === null ? "?" : Math.round(t.ttftMs)} ms, total ${t.durationMs === null ? "?" : Math.round(t.durationMs)} ms`;
    console.log(`  ${c.fixtureId} ${caseOutcome(c).padEnd(10)} ${timing}, ${tokens}, attempts ${t.attempts}${why ? `\n      ${why}` : ""}`);
  }
}
