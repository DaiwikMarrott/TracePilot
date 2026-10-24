import { loadConfig } from "./config";
import { createApp } from "./app";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  const mode = config.apiKey ? `live (${config.defaultModel}) and mock` : "mock only (no ANTHROPIC_API_KEY)";
  console.log(`TracePilot API listening on http://localhost:${config.port} — providers: ${mode}`);
});
