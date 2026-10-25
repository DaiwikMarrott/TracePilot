import { createHash, randomUUID } from "node:crypto";
import type {
  CaseResult,
  CreatePromptVersionRequest,
  Fixture,
  FixtureSelection,
  ModelSettings,
  PromptVersion,
  Run,
  RunStatus,
  RunWithCases,
} from "../../shared/types";
import { summarize } from "../../shared/summary";
import type { Db } from "./database";

interface PromptRow {
  id: number;
  version: number;
  label: string;
  system_prompt: string;
  user_template: string;
  parent_id: number | null;
  created_at: string;
}

interface RunRow {
  id: string;
  prompt_version_id: number;
  prompt_snapshot: string;
  model_settings: string;
  fixture_selection: FixtureSelection;
  fixture_snapshot: string;
  fixture_hash: string;
  status: RunStatus;
  status_reason: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface CaseRow {
  run_id: string;
  idx: number;
  fixture_id: string;
  status: CaseResult["status"];
  output: string;
  interrupted: number;
  evaluation: string | null;
  error: string | null;
  attempt_log: string;
  ttft_ms: number | null;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  request_id: string | null;
  message_id: string | null;
  served_model: string | null;
  stop_reason: string | null;
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
}

const toPrompt = (row: PromptRow): PromptVersion => ({
  id: row.id,
  version: row.version,
  label: row.label,
  systemPrompt: row.system_prompt,
  userTemplate: row.user_template,
  parentId: row.parent_id,
  createdAt: row.created_at,
});

const toCase = (row: CaseRow): CaseResult => ({
  runId: row.run_id,
  index: row.idx,
  fixtureId: row.fixture_id,
  status: row.status,
  output: row.output,
  interrupted: row.interrupted === 1,
  evaluation: row.evaluation ? JSON.parse(row.evaluation) : null,
  error: row.error ? JSON.parse(row.error) : null,
  attemptLog: JSON.parse(row.attempt_log),
  telemetry: {
    ttftMs: row.ttft_ms,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestId: row.request_id,
    messageId: row.message_id,
    servedModel: row.served_model,
    stopReason: row.stop_reason,
    attempts: row.attempts,
  },
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 checks existence without signalling
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function hashFixtures(fixtures: Fixture[]): string {
  return createHash("sha256").update(JSON.stringify(fixtures)).digest("hex").slice(0, 16);
}

export class Repository {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    /** Process executing runs through this repository; injectable for tests. */
    private readonly pid: number = process.pid,
    private readonly isAlive: (pid: number) => boolean = processIsAlive,
  ) {}

  // ---- prompt versions ----

  listPromptVersions(): PromptVersion[] {
    return (this.db.prepare("SELECT * FROM prompt_versions ORDER BY version").all() as PromptRow[]).map(toPrompt);
  }

  getPromptVersion(id: number): PromptVersion | null {
    const row = this.db.prepare("SELECT * FROM prompt_versions WHERE id = ?").get(id) as PromptRow | undefined;
    return row ? toPrompt(row) : null;
  }

  createPromptVersion(input: CreatePromptVersionRequest): PromptVersion {
    return this.db.transaction(() => {
      const { next } = this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM prompt_versions").get() as {
        next: number;
      };
      const result = this.db
        .prepare(
          "INSERT INTO prompt_versions (version, label, system_prompt, user_template, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(next, input.label, input.systemPrompt, input.userTemplate, input.parentId, this.now().toISOString());
      return this.getPromptVersion(Number(result.lastInsertRowid))!;
    })();
  }

  seedPromptVersions(seeds: CreatePromptVersionRequest[]): void {
    const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM prompt_versions").get() as { count: number };
    if (count > 0) return;
    let parentId: number | null = null;
    for (const seed of seeds) parentId = this.createPromptVersion({ ...seed, parentId }).id;
  }

  // ---- runs ----

  createRun(input: {
    prompt: PromptVersion;
    modelSettings: ModelSettings;
    fixtureSelection: FixtureSelection;
    fixtures: Fixture[];
  }): RunWithCases {
    const id = randomUUID();
    const { prompt, fixtures } = input;
    // Snapshots are deep copies serialized at creation time, so later edits to
    // prompts or fixture files cannot change what this run recorded.
    const promptSnapshot = {
      version: prompt.version,
      label: prompt.label,
      systemPrompt: prompt.systemPrompt,
      userTemplate: prompt.userTemplate,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO runs (id, prompt_version_id, prompt_snapshot, model_settings, fixture_selection, fixture_snapshot,
             fixture_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
        )
        .run(
          id,
          prompt.id,
          JSON.stringify(promptSnapshot),
          JSON.stringify(input.modelSettings),
          input.fixtureSelection,
          JSON.stringify(fixtures),
          hashFixtures(fixtures),
          this.now().toISOString(),
        );
      const insertCase = this.db.prepare(
        "INSERT INTO case_results (run_id, idx, fixture_id, status) VALUES (?, ?, ?, 'queued')",
      );
      fixtures.forEach((fixture, idx) => insertCase.run(id, idx, fixture.id));
    })();
    return this.getRunWithCases(id)!;
  }

  getRunWithCases(id: string): RunWithCases | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    if (!row) return null;
    const cases = this.getCases(id);
    return { ...this.toRun(row, cases), cases };
  }

  getRun(id: string): Run | null {
    const run = this.getRunWithCases(id);
    if (!run) return null;
    const { cases: _cases, ...rest } = run;
    return rest;
  }

  listRuns(limit = 50): Run[] {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as RunRow[];
    return rows.map((row) => this.toRun(row, this.getCases(row.id)));
  }

  getCases(runId: string): CaseResult[] {
    return (this.db.prepare("SELECT * FROM case_results WHERE run_id = ? ORDER BY idx").all(runId) as CaseRow[]).map(
      toCase,
    );
  }

  setRunStatus(id: string, status: RunStatus, reason: string | null = null): void {
    const now = this.now().toISOString();
    const terminal = status === "completed" || status === "failed" || status === "cancelled";
    this.db
      .prepare(
        `UPDATE runs SET status = ?, status_reason = ?,
           started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
           finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
           runner_pid = CASE WHEN ? = 'running' THEN ? ELSE runner_pid END
         WHERE id = ?`,
      )
      .run(status, reason, status, now, terminal ? 1 : 0, now, status, this.pid, id);
  }

  saveCase(result: CaseResult): void {
    const t = result.telemetry;
    this.db
      .prepare(
        `UPDATE case_results SET status = ?, output = ?, interrupted = ?, evaluation = ?, error = ?, attempt_log = ?,
           ttft_ms = ?, duration_ms = ?, input_tokens = ?, output_tokens = ?, request_id = ?, message_id = ?,
           served_model = ?, stop_reason = ?, attempts = ?, started_at = ?, finished_at = ?
         WHERE run_id = ? AND idx = ?`,
      )
      .run(
        result.status,
        result.output,
        result.interrupted ? 1 : 0,
        result.evaluation ? JSON.stringify(result.evaluation) : null,
        result.error ? JSON.stringify(result.error) : null,
        JSON.stringify(result.attemptLog),
        t.ttftMs,
        t.durationMs,
        t.inputTokens,
        t.outputTokens,
        t.requestId,
        t.messageId,
        t.servedModel,
        t.stopReason,
        t.attempts,
        result.startedAt,
        result.finishedAt,
        result.runId,
        result.index,
      );
  }

  /**
   * Called on startup: a run still "running" whose executing process no longer
   * exists will never finish. Record that honestly instead of leaving it pending.
   * Runs owned by another live process (e.g. the CLI) are left alone, and queued
   * runs stay queued because they can still be started.
   */
  failAbandonedRuns(): number {
    const now = this.now().toISOString();
    return this.db.transaction(() => {
      const running = this.db.prepare("SELECT id, runner_pid FROM runs WHERE status = 'running'").all() as {
        id: string;
        runner_pid: number | null;
      }[];
      const abandoned = running.filter((r) => r.runner_pid === null || r.runner_pid === this.pid || !this.isAlive(r.runner_pid));
      for (const { id } of abandoned) {
        this.db
          .prepare("UPDATE runs SET status = 'failed', status_reason = ?, finished_at = ? WHERE id = ?")
          .run("Server stopped before the run finished", now, id);
      }
      return abandoned.length;
    })();
  }

  private toRun(row: RunRow, cases: CaseResult[]): Run {
    return {
      id: row.id,
      promptVersionId: row.prompt_version_id,
      promptSnapshot: JSON.parse(row.prompt_snapshot),
      modelSettings: JSON.parse(row.model_settings),
      fixtureSelection: row.fixture_selection,
      fixtureSnapshot: JSON.parse(row.fixture_snapshot),
      fixtureHash: row.fixture_hash,
      status: row.status,
      statusReason: row.status_reason,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      summary: summarize(cases),
    };
  }
}
