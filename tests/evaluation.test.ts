import { describe, expect, it } from "vitest";
import { SEED_PROMPTS } from "../fixtures/prompts";
import { TICKETS } from "../fixtures/tickets";
import { openDatabase } from "../server/db/database";
import { Repository } from "../server/db/repository";
import { MockProvider } from "../server/provider/mock";
import { RunManager } from "../server/runner/runManager";
import { defaultModelSettings } from "../shared/defaults";
import { caseOutcome } from "../shared/summary";

function setup() {
  const repo = new Repository(openDatabase(":memory:"));
  repo.seedPromptVersions(SEED_PROMPTS);
  const manager = new RunManager({ repo, providers: { mock: new MockProvider({ chunkDelayMs: 0 }) } });
  const runVersion = async (id: number, settings = defaultModelSettings()) => {
    const run = repo.createRun({
      prompt: repo.getPromptVersion(id)!,
      modelSettings: settings,
      fixtureSelection: "dev",
      fixtures: TICKETS.filter((t) => t.split === "dev"),
    });
    await manager.start(run.id);
    return repo.getRunWithCases(run.id)!;
  };
  return { repo, runVersion };
}

describe("evaluating prompt versions against the same fixture snapshot", () => {
  it("records a per-check explanation for every failed case", async () => {
    const { runVersion } = setup();
    const v1 = await runVersion(1);
    const v2 = await runVersion(2);

    expect(v1.fixtureHash).toBe(v2.fixtureHash);
    expect(v1.status).toBe("completed");
    // The mock wraps v1's answers in a code fence, so every v1 case fails json_parse.
    expect(v1.summary).toMatchObject({ total: 8, passed: 0, failed: 8 });
    expect(v2.summary).toMatchObject({ total: 8, passed: 8, failed: 0 });

    for (const c of v1.cases) {
      const failed = c.evaluation!.checks.filter((check) => check.status === "failed");
      expect(failed.length).toBeGreaterThan(0);
      for (const check of failed) expect(check.detail.length).toBeGreaterThan(10);
    }
    const t02 = v1.cases.find((c) => c.fixtureId === "T02")!;
    expect(t02.evaluation!.checks.find((c) => c.name === "urgency_match")!.detail).toBe(
      'Predicted "medium", expected "high". (checked against the recovered object)',
    );
  });

  it("labels malformed output as failed checks rather than errors", async () => {
    const { runVersion } = setup();
    const run = await runVersion(2, { ...defaultModelSettings(), mockScenario: "malformed" });
    expect(run.cases.every((c) => c.status === "completed" && caseOutcome(c) === "failed")).toBe(true);
    expect(run.cases[0]!.evaluation!.checks[0]).toMatchObject({ name: "json_parse", status: "failed" });
  });
});
