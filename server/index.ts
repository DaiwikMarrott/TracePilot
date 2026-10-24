import { SEED_PROMPTS } from "../fixtures/prompts";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { Repository } from "./db/repository";
import { buildProviders } from "./providers";
import { RunManager } from "./runner/runManager";

const config = loadConfig();
const repo = new Repository(openDatabase(config.dbPath));
repo.seedPromptVersions(SEED_PROMPTS);
const abandoned = repo.failAbandonedRuns();
if (abandoned > 0) console.warn(`Marked ${abandoned} unfinished run(s) from a previous process as failed.`);

const manager = new RunManager({
  repo,
  providers: buildProviders(config),
});

const app = createApp({ config, repo, manager });
app.listen(config.port, () => {
  const live = [
    config.apiKey && `Claude (${config.defaultModel})`,
    config.googleApiKey && `Gemini (${config.googleModel})`,
  ].filter(Boolean);
  const mode = live.length ? `mock, ${live.join(", ")}` : "mock only (no ANTHROPIC_API_KEY or GEMINI_API_KEY)";
  console.log(`TracePilot API listening on http://localhost:${config.port} — providers: ${mode}`);
});
