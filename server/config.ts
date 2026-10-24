export interface ServerConfig {
  port: number;
  dbPath: string;
  apiKey: string | null;
  defaultModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.TRACEPILOT_DB ?? "data/tracepilot.db",
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    defaultModel: env.TRACEPILOT_MODEL?.trim() || "claude-opus-5-5",
  };
}
