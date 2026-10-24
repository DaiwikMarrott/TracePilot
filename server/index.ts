import { SEED_PROMPTS } from "../fixtures/prompts";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { Repository } from "./db/repository";
import { ClaudeProvider } from "./provider/claude";
import { MockProvider } from "./provider/mock";
import { RunManager } from "./runner/runManager";

const config = loadConfig();
const repo = new Repository(openDatabase(config.dbPath));
repo.seedPromptVersions(SEED_PROMPTS);
const abandoned = repo.failAbandonedRuns();
if (abandoned > 0) console.warn(`Marked ${abandoned} unfinished run(s) from a previous process as failed.`);

const manager = new RunManager({
  repo,
  providers: {
    mock: new MockProvider(),
    ...(config.apiKey ? { anthropic: new ClaudeProvider({ apiKey: config.apiKey }) } : {}),
  },
});

const app = createApp({ config, repo, manager });
app.listen(config.port, () => {
  const mode = config.apiKey ? `live (${config.defaultModel}) and mock` : "mock only (no ANTHROPIC_API_KEY)";
  console.log(`TracePilot API listening on http://localhost:${config.port} — providers: ${mode}`);
});
