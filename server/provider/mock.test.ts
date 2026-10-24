import { describe, expect, it } from "vitest";
import { defaultModelSettings } from "../../shared/defaults";
import { MockProvider } from "./mock";

const request = (attempt: number, mockScenario: ReturnType<typeof defaultModelSettings>["mockScenario"]) => ({
  system: "Respond with only JSON. Urgency guidelines: ...",
  user: "Subject: API down\n\nproduction completely down",
  settings: { ...defaultModelSettings(), mockScenario },
  attempt,
});

describe("MockProvider scenarios", () => {
  it("rate-limits the first attempt of every case, every run", async () => {
    const provider = new MockProvider({ chunkDelayMs: 0 });
    const signal = new AbortController().signal;
    for (let run = 0; run < 2; run++) {
      await expect(provider.stream(request(1, "rate_limit_once"), { onText: () => {} }, signal)).rejects.toMatchObject({
        kind: "rate_limit",
        retryable: true,
      });
      await expect(provider.stream(request(2, "rate_limit_once"), { onText: () => {} }, signal)).resolves.toMatchObject({
        text: '{"category":"technical_support","urgency":"high"}',
      });
    }
  });
});
