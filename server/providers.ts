import type { HealthResponse, LiveProviderName, ProviderName } from "../shared/types";
import type { ServerConfig } from "./config";
import { ClaudeProvider } from "./provider/claude";
import { GeminiProvider } from "./provider/gemini";
import { MockProvider } from "./provider/mock";
import type { Provider } from "./provider/types";

/** Providers available on this server: the mock always, live ones only when their key is set. */
export function buildProviders(config: ServerConfig): Partial<Record<ProviderName, Provider>> {
  return {
    mock: new MockProvider(),
    ...(config.apiKey ? { anthropic: new ClaudeProvider({ apiKey: config.apiKey }) } : {}),
    ...(config.googleApiKey ? { google: new GeminiProvider({ apiKey: config.googleApiKey }) } : {}),
  };
}

export function liveProviders(config: ServerConfig): HealthResponse["providers"] {
  return {
    anthropic: { available: config.apiKey !== null, defaultModel: config.defaultModel },
    google: { available: config.googleApiKey !== null, defaultModel: config.googleModel },
  };
}

export const KEY_VARIABLE: Record<LiveProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
};
