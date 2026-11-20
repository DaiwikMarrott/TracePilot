import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SEED_PROMPTS } from "../fixtures/prompts";
import { TICKETS } from "../fixtures/tickets";
import { openDatabase } from "../server/db/database";
import { Repository } from "../server/db/repository";
import { defaultModelSettings } from "../shared/defaults";
import type { PromptVersion, RunWithCases } from "../shared/types";
import { startTestServer, type TestServer } from "./helpers";

const dirs: string[] = [];
const tempDbPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "tracepilot-"));
  dirs.push(dir);
  return join(dir, "test.db");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fixtures", () => {
  it("has 12 synthetic tickets with four reserved for final evaluation", () => {
    expect(TICKETS).toHaveLength(12);
    expect(TICKETS.filter((t) => t.split === "holdout")).toHaveLength(4);
    expect(new Set(TICKETS.map((t) => t.id)).size).toBe(12);
  });
});

describe("prompt versions", () => {
  it("survive a restart, and migrations do not re-run", () => {
    const path = tempDbPath();
    const first = openDatabase(path);
    const repo = new Repository(first);
    repo.seedPromptVersions(SEED_PROMPTS);
    repo.createPromptVersion({ label: "Edited", systemPrompt: "x", userTemplate: "{{body}}", parentId: 2 });
    first.close();

    const reopened = new Repository(openDatabase(path));
    reopened.seedPromptVersions(SEED_PROMPTS); // must not duplicate seeds
    expect(reopened.listPromptVersions().map((v) => [v.version, v.label, v.parentId])).toEqual([
      [1, "Baseline", null],
      [2, "Strict JSON + urgency rubric", 1],
      [3, "Baseline + bare JSON only", 1],
      [4, "Edited", 2],
    ]);
  });

  it("appends seeds added after a workspace was created, without touching existing versions", () => {
    const path = tempDbPath();
    const older = new Repository(openDatabase(path));
    older.seedPromptVersions(SEED_PROMPTS.slice(0, 2)); // a workspace from before v3 existed
    older.createPromptVersion({ label: "Mine", systemPrompt: "x", userTemplate: "{{body}}", parentId: 2 });

    const upgraded = new Repository(openDatabase(path));
    upgraded.seedPromptVersions(SEED_PROMPTS);
    upgraded.seedPromptVersions(SEED_PROMPTS);
    expect(upgraded.listPromptVersions().map((v) => [v.version, v.label, v.parentId])).toEqual([
      [1, "Baseline", null],
      [2, "Strict JSON + urgency rubric", 1],
      [3, "Mine", 2],
      [4, "Baseline + bare JSON only", 1],
    ]);
  });

  it("cannot be updated or deleted at the database level", () => {
    const db = openDatabase(":memory:");
    new Repository(db).seedPromptVersions(SEED_PROMPTS);
    expect(() => db.prepare("UPDATE prompt_versions SET system_prompt = 'changed' WHERE id = 1").run()).toThrow(
      /immutable/,
    );
    expect(() => db.prepare("DELETE FROM prompt_versions WHERE id = 1").run()).toThrow(/immutable/);
  });

  it("marks runs abandoned by a previous process as failed", () => {
    const path = tempDbPath();
    const db = openDatabase(path);
    const repo = new Repository(db, undefined, 4242);
    repo.seedPromptVersions(SEED_PROMPTS);
    const run = repo.createRun({
      prompt: repo.getPromptVersion(1)!,
      modelSettings: defaultModelSettings(),
      fixtureSelection: "dev",
      fixtures: TICKETS.slice(0, 2),
    });
    repo.setRunStatus(run.id, "running");
    db.close();

    const reopened = new Repository(openDatabase(path), undefined, 5000, () => false);
    expect(reopened.failAbandonedRuns()).toBe(1);
    const after = reopened.getRunWithCases(run.id)!;
    expect(after.status).toBe("failed");
    expect(after.statusReason).toMatch(/Server stopped/);
    expect(after.summary.unfinished).toBe(2);
  });

  it("keeps partial output saved mid-stream and labels that case interrupted after a crash", () => {
    const path = tempDbPath();
    const db = openDatabase(path);
    const repo = new Repository(db, undefined, 4242);
    repo.seedPromptVersions(SEED_PROMPTS);
    const run = repo.createRun({
      prompt: repo.getPromptVersion(1)!,
      modelSettings: defaultModelSettings(),
      fixtureSelection: "dev",
      fixtures: TICKETS.slice(0, 2),
    });
    repo.setRunStatus(run.id, "running");
    // What executeCase's periodic save leaves behind when the process dies mid-stream.
    repo.saveCase({ ...run.cases[0]!, status: "running", output: '{"category": "bill', startedAt: new Date().toISOString(), telemetry: { ...run.cases[0]!.telemetry, attempts: 1 } });
    db.close();

    const reopened = new Repository(openDatabase(path), undefined, 5000, () => false);
    reopened.failAbandonedRuns();
    const [streaming, notStarted] = reopened.getCases(run.id);
    expect(streaming).toMatchObject({ status: "failed", interrupted: true, output: '{"category": "bill', error: { kind: "stream_interrupted" } });
    expect(streaming!.finishedAt).not.toBeNull();
    expect(notStarted).toMatchObject({ status: "queued", output: "", error: null });
  });

  it("leaves running runs owned by another live process (e.g. the CLI) and queued runs alone", () => {
    const path = tempDbPath();
    const cli = new Repository(openDatabase(path), undefined, 4242);
    cli.seedPromptVersions(SEED_PROMPTS);
    const input = { prompt: cli.getPromptVersion(1)!, modelSettings: defaultModelSettings(), fixtureSelection: "dev" as const, fixtures: TICKETS.slice(0, 1) };
    const running = cli.createRun(input);
    cli.setRunStatus(running.id, "running");
    const queued = cli.createRun(input);

    const server = new Repository(openDatabase(path), undefined, 5000, (pid) => pid === 4242);
    expect(server.failAbandonedRuns()).toBe(0);
    expect(server.getRun(running.id)!.status).toBe("running");
    expect(server.getRun(queued.id)!.status).toBe("queued");
  });
});

describe("run snapshots via the API", () => {
  let server: TestServer;
  afterEach(() => server?.close());

  it("saving an edited prompt creates a new version and leaves earlier runs unchanged", async () => {
    server = await startTestServer();
    const created = await server.json<RunWithCases>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ promptVersionId: 2, fixtureSelection: "dev", modelSettings: defaultModelSettings() }),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("queued");
    expect(created.body.fixtureSnapshot).toHaveLength(8);
    expect(created.body.cases.every((c) => c.status === "queued")).toBe(true);

    const original = created.body.promptSnapshot.systemPrompt;
    const edit = await server.json<PromptVersion>("/api/prompts", {
      method: "POST",
      body: JSON.stringify({ label: "Tweak", systemPrompt: original + "\nBe terse.", userTemplate: "{{body}}", parentId: 2 }),
    });
    expect(edit.status).toBe(201);
    expect(edit.body.version).toBe(SEED_PROMPTS.length + 1);

    const versions = await server.json<PromptVersion[]>("/api/prompts");
    expect(versions.body.find((v) => v.id === 2)!.systemPrompt).toBe(original);
    const reread = await server.json<RunWithCases>(`/api/runs/${created.body.id}`);
    expect(reread.body.promptSnapshot.systemPrompt).toBe(original);
    expect(reread.body.promptSnapshot.version).toBe(2);
  });

  it("rejects invalid input with explanations", async () => {
    server = await startTestServer();
    const bad = await server.json<{ error: { issues: string[] } }>("/api/prompts", {
      method: "POST",
      body: JSON.stringify({ label: "", systemPrompt: "x", userTemplate: "no placeholder", parentId: null }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues.join(" ")).toMatch(/Label is required/);
    expect(bad.body.error.issues.join(" ")).toMatch(/\{\{body\}\}/);

    const live = await server.json<{ error: { message: string } }>("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        promptVersionId: 1,
        fixtureSelection: "dev",
        modelSettings: { ...defaultModelSettings(), provider: "anthropic" },
      }),
    });
    expect(live.status).toBe(400);
    expect(live.body.error.message).toMatch(/ANTHROPIC_API_KEY/);
  });
});
