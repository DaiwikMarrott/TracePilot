import { afterEach, describe, expect, it } from "vitest";
import { TICKETS } from "../fixtures/tickets";
import { defaultModelSettings } from "../shared/defaults";
import { startTestServer, type TestServer } from "../tests/helpers";

describe("GET /api/health", () => {
  let server: TestServer;
  afterEach(() => server?.close());

  it("reports live availability without exposing the key", async () => {
    server = await startTestServer({ apiKey: "sk-secret" });
    const res = await fetch(`${server.url}/api/health`);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      providers: { anthropic: { available: true }, google: { available: false } },
    });
    expect(text).not.toContain("sk-secret");
  });
});

describe("GET /api/runs/:id/export", () => {
  let server: TestServer;
  afterEach(() => server?.close());

  it("downloads a run as JSON or CSV and rejects other formats", async () => {
    server = await startTestServer();
    const prompt = server.repo.getPromptVersion(1)!;
    const run = server.repo.createRun({ prompt, modelSettings: defaultModelSettings(), fixtureSelection: "holdout", fixtures: TICKETS.filter((t) => t.split === "holdout") });

    const json = await fetch(`${server.url}/api/runs/${run.id}/export`);
    expect(json.headers.get("content-disposition")).toBe(`attachment; filename="tracepilot-v1-${run.id.slice(0, 8)}.json"`);
    expect(((await json.json()) as { cases: unknown[] }).cases).toHaveLength(4);

    const csv = await fetch(`${server.url}/api/runs/${run.id}/export?format=csv`);
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    const lines = (await csv.text()).trimEnd().split("\r\n");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain(",unfinished,false,");

    expect((await fetch(`${server.url}/api/runs/${run.id}/export?format=xml`)).status).toBe(400);
    expect((await fetch(`${server.url}/api/runs/nope/export`)).status).toBe(404);
  });
});
