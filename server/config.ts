export interface ServerConfig {
  port: number;
  dbPath: string;
  /** Anthropic API key (Claude). */
  apiKey: string | null;
  defaultModel: string;
  /** Gemini Developer API key, used as a development stand-in for live runs. */
  googleApiKey: string | null;
  googleModel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.TRACEPILOT_DB ?? "data/tracepilot.db",
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    defaultModel: env.TRACEPILOT_MODEL?.trim() || "claude-opus-5-5",
    googleApiKey: env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || null,
    googleModel: env.TRACEPILOT_GOOGLE_MODEL?.trim() || "gemini-3.5-flash",
  };
}
