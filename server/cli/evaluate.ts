// Runs prompt versions against a fixture split from the command line and
// prints a report. Runs are recorded in the same database the interface
// uses, so they can be inspected and compared there afterwards.
//
//   npm run eval -- --provider google --split all --versions 1,2 --repeat 3 --json report.json
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { SEED_PROMPTS } from "../../fixtures/prompts";
import { defaultModelSettings } from "../../shared/defaults";
import { caseOutcome } from "../../shared/summary";
import type { Effort, FixtureSelection, ProviderName, RunWithCases } from "../../shared/types";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { Repository } from "../db/repository";
import { buildProviders, KEY_VARIABLE } from "../providers";
import { selectFixtures } from "../routes/runs";
import { RunManager } from "../runner/runManager";

const { values } = parseArgs({
  options: {
    provider: { type: "string", default: "mock" },
    split: { type: "string", default: "holdout" },
    versions: { type: "string", default: "1,2" },
    model: { type: "string" },
    effort: { type: "string", default: "low" },
    repeat: { type: "string", default: "1" },
    json: { type: "string" },
  },
});

const config = loadConfig();
const provider = values.provider as ProviderName;
const providers = buildProviders(config);
if (!providers[provider]) {
  const hint = provider === "mock" ? "" : ` (set ${KEY_VARIABLE[provider]} in .env)`;
  console.error(`Provider "${provider}" is not available${hint}.`);
  process.exit(1);
}

const repo = new Repository(openDatabase(config.dbPath));
repo.seedPromptVersions(SEED_PROMPTS);
const manager = new RunManager({ repo, providers });

const defaultModel = provider === "google" ? config.googleModel : config.defaultModel;
const settings = {
  ...defaultModelSettings(values.model ?? defaultModel),
  provider,
  effort: values.effort as Effort,
};
const selection = values.split as FixtureSelection;
const fixtures = selectFixtures(selection);
const repeat = Math.max(1, Number(values.repeat));

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    const id = manager.activeRunId();
    if (id) manager.cancel(id, `Interrupted from the command line (${signal})`);
  });
}
// Rewritten after every run so a partial evaluation still leaves a report.
const writeReport = () => {
  if (values.json) writeFileSync(values.json, JSON.stringify({ provider, settings, selection, repeat, runs }, null, 2));
};

const ms = (v: number | null) => (v === null ? "?" : `${Math.round(v)} ms`);
const runs: RunWithCases[] = [];

for (const version of values.versions.split(",").map(Number)) {
  const prompt = repo.listPromptVersions().find((v) => v.version === version);
  if (!prompt) {
    console.error(`No prompt version v${version}`);
    continue;
  }
  for (let rep = 1; rep <= repeat && !interrupted; rep++) {
    const created = repo.createRun({ prompt, modelSettings: settings, fixtureSelection: selection, fixtures });
    await manager.start(created.id);
    const run = repo.getRunWithCases(created.id)!;
    runs.push(run);
    writeReport();
    const label = provider === "mock" ? "mock provider" : `${provider} ${settings.model}`;
    const s = run.summary;
    console.log(`\nv${version} — ${prompt.label} · ${label} · ${selection} · repetition ${rep}/${repeat} · run ${run.id}`);
    console.log(`status ${run.status}${run.statusReason ? ` (${run.statusReason})` : ""} · passed ${s.passed}/${s.total} · failed ${s.failed} · error ${s.errored} · cancelled ${s.cancelled} · unfinished ${s.unfinished}`);
    for (const c of run.cases) {
      const t = c.telemetry;
      const failed = c.evaluation?.checks.filter((x) => x.status === "failed").map((x) => `${x.name}: ${x.detail}`) ?? [];
      const retries = c.attemptLog.filter((a) => a.outcome === "error").map((a) => `${a.errorKind}${a.retryDelayMs !== undefined ? ` (retry in ${a.retryDelayMs} ms)` : ""}`);
      const why = [c.error ? `${c.error.kind}: ${c.error.message}` : failed.join(" | "), retries.length ? `attempt errors: ${retries.join(", ")}` : ""]
        .filter(Boolean)
        .join("\n      ");
      console.log(
        `  ${c.fixtureId} ${caseOutcome(c).padEnd(10)} ttft ${ms(t.ttftMs)}, total ${ms(t.durationMs)}, ${t.inputTokens ?? "?"}/${t.outputTokens ?? "?"} tok, attempts ${t.attempts}, served ${t.servedModel ?? "?"}, stop ${t.stopReason ?? "?"}${why ? `\n      ${why}` : ""}`,
      );
    }
  }
}

if (values.json) console.log(`\nWrote ${runs.length} run(s) to ${values.json}`);
