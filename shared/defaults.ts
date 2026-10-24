import type { ModelSettings } from "./types";

export function defaultModelSettings(model = "claude-opus-5-5"): ModelSettings {
  return {
    provider: "mock",
    model,
    // Classification output is a short JSON object; leave room for thinking.
    maxTokens: 4096,
    effort: "low",
    timeoutMs: 30_000,
    maxRetries: 2,
    refusalFallback: true,
    mockScenario: "none",
  };
}
