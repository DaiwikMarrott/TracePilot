import type { CaseResult, Fixture, ProviderName, RunEvent, RunStatus, RunWithCases } from "../../shared/types";
import type { Repository } from "../db/repository";
import { renderTemplate, type Provider } from "../provider/types";
import { executeCase, type CaseContext } from "./executeCase";
import type { Sleep } from "../provider/mock";
import { abortableSleep } from "../provider/mock";

export type RunListener = (event: RunEvent) => void;

export interface RunManagerDeps {
  repo: Repository;
  providers: Partial<Record<ProviderName, Provider>>;
  /** Epoch milliseconds; injectable so tests can control time. */
  now?: () => number;
  sleep?: Sleep;
}

interface ActiveRun {
  runId: string;
  controller: AbortController;
  cancelReason: string | null;
  listeners: Set<RunListener>;
  done: Promise<void>;
}

// Errors that will fail every remaining case the same way; stop the run.
const FATAL_KINDS = new Set(["auth", "bad_request"]);

/**
 * Owns the single active evaluation. Cases run strictly one after another;
 * a second run cannot start until the first reaches a final state.
 */
export class RunManager {
  private active: ActiveRun | null = null;
  private readonly now: () => number;
  private readonly sleep: Sleep;

  constructor(private readonly deps: RunManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? abortableSleep;
  }

  activeRunId(): string | null {
    return this.active?.runId ?? null;
  }

  isActive(runId: string): boolean {
    return this.active?.runId === runId;
  }

  subscribe(runId: string, listener: RunListener): () => void {
    const active = this.active;
    if (!active || active.runId !== runId) return () => {};
    active.listeners.add(listener);
    return () => active.listeners.delete(listener);
  }

  unsubscribe(runId: string, listener: RunListener): void {
    if (this.isActive(runId)) this.active!.listeners.delete(listener);
  }

  listenerCount(runId: string): number {
    return this.isActive(runId) ? this.active!.listeners.size : 0;
  }

  /**
   * Starts a queued run. Resolves when the run reaches a final state. Pass a
   * listener to receive every event, including the first status change.
   */
  start(runId: string, listener?: RunListener): Promise<void> {
    if (this.active) {
      if (this.active.runId === runId) return this.active.done;
      throw new Error(`Run ${this.active.runId} is already in progress`);
    }
    const run = this.deps.repo.getRunWithCases(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== "queued") throw new Error(`Run ${runId} is ${run.status}, not queued`);

    const active: ActiveRun = {
      runId,
      controller: new AbortController(),
      cancelReason: null,
      listeners: new Set(listener ? [listener] : []),
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.execute(run, active).finally(() => {
      if (this.active === active) this.active = null;
    });
    return active.done;
  }

  /** Requests cancellation. The in-flight provider request is aborted upstream. */
  cancel(runId: string, reason: string): boolean {
    const active = this.active;
    if (!active || active.runId !== runId) return false;
    if (!active.controller.signal.aborted) {
      active.cancelReason = reason;
      active.controller.abort(new Error(reason));
    }
    return true;
  }

  private emit(active: ActiveRun, event: RunEvent) {
    for (const listener of active.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("run listener failed", err);
      }
    }
  }

  private async execute(run: RunWithCases, active: ActiveRun): Promise<void> {
    const { repo } = this.deps;
    const signal = active.controller.signal;
    const provider = this.deps.providers[run.modelSettings.provider];

    const finish = (status: RunStatus, reason: string | null) => {
      repo.setRunStatus(run.id, status, reason);
      this.emit(active, { type: "run_status", runId: run.id, status, reason });
      this.emit(active, { type: "run_end", run: repo.getRun(run.id)! });
    };

    if (!provider) {
      finish("failed", `Provider "${run.modelSettings.provider}" is not configured on the server`);
      return;
    }

    repo.setRunStatus(run.id, "running");
    this.emit(active, { type: "run_status", runId: run.id, status: "running", reason: null });

    let fatal: string | null = null;
    try {
      for (const [index, fixture] of run.fixtureSnapshot.entries()) {
        if (signal.aborted) break;
        const result = await this.runCase(run, index, fixture, provider, active);
        repo.saveCase(result);
        this.emit(active, { type: "case_result", runId: run.id, result });
        if (result.error && FATAL_KINDS.has(result.error.kind)) {
          fatal = `Stopped after a non-retryable ${result.error.kind} error: ${result.error.message}`;
          break;
        }
      }
    } catch (err) {
      // A bug in the runner itself; record it rather than leaving the run "running".
      console.error(err);
      finish("failed", `Runner error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (signal.aborted) finish("cancelled", active.cancelReason);
    else if (fatal) finish("failed", fatal);
    else finish("completed", null);
  }

  private runCase(
    run: RunWithCases,
    index: number,
    fixture: Fixture,
    provider: Provider,
    active: ActiveRun,
  ): Promise<CaseResult> {
    const ctx: CaseContext = {
      runId: run.id,
      index,
      fixture,
      provider,
      request: {
        system: run.promptSnapshot.systemPrompt,
        user: renderTemplate(run.promptSnapshot.userTemplate, fixture.ticket),
        settings: run.modelSettings,
      },
      signal: active.controller.signal,
      now: this.now,
      sleep: this.sleep,
      emit: (event) => this.emit(active, event),
      saveProgress: (result) => this.deps.repo.saveCase(result),
    };
    return executeCase(ctx);
  }
}
