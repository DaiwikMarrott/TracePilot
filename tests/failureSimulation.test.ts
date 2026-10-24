import { delay, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SEED_PROMPTS } from "../fixtures/prompts";
import { TICKETS } from "../fixtures/tickets";
import { openDatabase } from "../server/db/database";
import { Repository } from "../server/db/repository";
import { ClaudeProvider } from "../server/provider/claude";
import { RunManager } from "../server/runner/runManager";
import { defaultModelSettings } from "../shared/defaults";
import type { ModelSettings, RunEvent } from "../shared/types";
import { API_URL, apiError, sequence, sseResponse } from "./anthropicMock";

// End-to-end failure simulation: the real Claude adapter and runner, with the
// Anthropic API replaced by MSW. Backoff sleeps are recorded instead of
// waited, so the suite is fast and every retry delay is asserted exactly.

const mswServer = setupServer();
beforeAll(() => mswServer.listen({ onUnhandledFrame: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

const answer = (i: number) => JSON.stringify(TICKETS[i]!.expected);

function harness(settings: Partial<ModelSettings> = {}, fixtureCount = 1) {
  // Record the signal of every HTTP request the SDK makes, to prove aborts reach the wire.
  const fetchSignals: AbortSignal[] = [];
  const recordingFetch: typeof fetch = (input, init) => {
    if (init?.signal) fetchSignals.push(init.signal);
    return fetch(input, init);
  };
  const repo = new Repository(openDatabase(":memory:"));
  repo.seedPromptVersions(SEED_PROMPTS);
  const sleeps: number[] = [];
  const manager = new RunManager({
    repo,
    providers: { anthropic: new ClaudeProvider({ apiKey: "test-key", fetch: recordingFetch }) },
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      if (signal.aborted) throw signal.reason;
    },
  });
  const run = repo.createRun({
    prompt: repo.getPromptVersion(2)!,
    modelSettings: { ...defaultModelSettings(), provider: "anthropic", timeoutMs: 2_000, maxRetries: 2, ...settings },
    fixtureSelection: "dev",
    fixtures: TICKETS.slice(0, fixtureCount),
  });
  const events: RunEvent[] = [];
  const start = () => manager.start(run.id, (e) => events.push(e)).then(() => repo.getRunWithCases(run.id)!);
  return { repo, manager, run, events, sleeps, fetchSignals, start };
}

describe("failure simulation against a mocked Claude API", () => {
  it("rate limit: retries after retry-after, then succeeds; both request IDs are kept", async () => {
    const api = sequence(
      () => apiError(429, "rate_limit_error", "Rate limited", { "retry-after": "2" }),
      () => sseResponse({ steps: [{ kind: "text", text: answer(0) }], requestId: "req_second" }),
    );
    mswServer.use(api.handler);
    const h = harness();
    const run = await h.start();

    expect(api.calls()).toBe(2);
    expect(h.sleeps).toEqual([2000]);
    const c = run.cases[0]!;
    expect(c.status).toBe("completed");
    expect(c.evaluation!.passed).toBe(true);
    expect(c.attemptLog.map((a) => [a.outcome, a.errorKind, a.requestId])).toEqual([
      ["error", "rate_limit", "req_err_429"],
      ["success", undefined, "req_second"],
    ]);
    expect(h.events.filter((e) => e.type === "case_retry")).toHaveLength(1);
  });

  it("persistent overload: bounded retries with exponential backoff, then a recorded failure", async () => {
    const api = sequence(() => apiError(529, "overloaded_error", "Overloaded"));
    mswServer.use(api.handler);
    const h = harness({ maxRetries: 2 });
    const run = await h.start();

    expect(api.calls()).toBe(3);
    expect(h.sleeps).toEqual([250, 500]);
    expect(run.status).toBe("completed"); // the run finished; the case did not
    expect(run.cases[0]).toMatchObject({ status: "failed", error: { kind: "overloaded" } });
    expect(run.summary).toMatchObject({ errored: 1, passed: 0 });
  });

  it("timeout: a response that never starts hits the deadline and is retried", async () => {
    let call = 0;
    mswServer.use(
      http.post(API_URL, async () => {
        call += 1;
        if (call === 1) await delay("infinite");
        return sseResponse({ steps: [{ kind: "text", text: answer(0) }] });
      }),
    );
    const h = harness({ timeoutMs: 150 });
    const run = await h.start();
    const c = run.cases[0]!;
    expect(c.attemptLog[0]).toMatchObject({ outcome: "error", errorKind: "timeout", message: "No complete response within 150 ms" });
    expect(c.status).toBe("completed");
    expect(c.telemetry.attempts).toBe(2);
  });

  it("malformed response: completes, fails the JSON check, and explains why", async () => {
    mswServer.use(
      sequence(() =>
        sseResponse({ steps: [{ kind: "text", text: "Category: billing\nUrgency: medium" }], usage: { input_tokens: 90, output_tokens: 9 } }),
      ).handler,
    );
    const run = await harness().start();
    const c = run.cases[0]!;
    expect(c.status).toBe("completed");
    expect(c.evaluation!.passed).toBe(false);
    expect(c.evaluation!.checks[0]).toMatchObject({ name: "json_parse", status: "failed", detail: expect.stringMatching(/not valid JSON/) });
    expect(c.telemetry).toMatchObject({ inputTokens: 90, outputTokens: 9 });
  });

  it("missing usage in the stream is recorded as unknown, not zero", async () => {
    mswServer.use(sequence(() => sseResponse({ steps: [{ kind: "text", text: answer(0) }], usage: null })).handler);
    const run = await harness().start();
    expect(run.cases[0]!.telemetry.outputTokens).toBeNull();
  });

  it("interrupted stream (connection dropped): keeps partial output, labels it, and does not retry", async () => {
    const api = sequence(() =>
      // Pause so the delta reaches the client before the socket dies.
      sseResponse({ steps: [{ kind: "text", text: '{"category": "bil' }, { kind: "pause", ms: 20 }, { kind: "cut" }] }),
    );
    mswServer.use(api.handler);
    const run = await harness().start();
    expect(api.calls()).toBe(1);
    expect(run.cases[0]).toMatchObject({
      status: "failed",
      interrupted: true,
      output: '{"category": "bil',
      evaluation: null,
      error: { kind: "stream_interrupted" },
    });
  });

  it("interrupted stream (error event mid-stream): same policy, request ID preserved", async () => {
    mswServer.use(
      sequence(() =>
        sseResponse({
          steps: [{ kind: "text", text: "{" }, { kind: "error_event", type: "overloaded_error", message: "Overloaded" }],
          requestId: "req_mid_stream",
        }),
      ).handler,
    );
    const run = await harness().start();
    expect(run.cases[0]).toMatchObject({ status: "failed", interrupted: true, output: "{" });
    expect(run.cases[0]!.telemetry.requestId).toBe("req_mid_stream");
  });

  it("an error event before any text is retried like any pre-output failure", async () => {
    const api = sequence(
      () => sseResponse({ steps: [{ kind: "error_event", type: "overloaded_error", message: "Overloaded" }] }),
      () => sseResponse({ steps: [{ kind: "text", text: answer(0) }] }),
    );
    mswServer.use(api.handler);
    const run = await harness().start();
    expect(api.calls()).toBe(2);
    expect(run.cases[0]!.status).toBe("completed");
  });

  it("authentication failure stops the run instead of failing every case the same way", async () => {
    const api = sequence(() => apiError(401, "authentication_error", "invalid x-api-key"));
    mswServer.use(api.handler);
    const run = await harness({}, 3).start();
    expect(api.calls()).toBe(1);
    expect(run.status).toBe("failed");
    expect(run.statusReason).toMatch(/non-retryable auth error/);
    expect(run.summary).toMatchObject({ errored: 1, unfinished: 2 });
  });

  it("cancellation mid-stream aborts the upstream request and records state transitions", async () => {
    mswServer.use(
      sequence(() => sseResponse({ steps: [{ kind: "text", text: "{" }, { kind: "pause", ms: 10_000 }, { kind: "text", text: "}" }] }))
        .handler,
    );
    const h = harness({}, 2);
    const pending = h.start();
    while (!h.events.some((e) => e.type === "case_delta")) await new Promise((r) => setTimeout(r, 5));
    h.manager.cancel(h.run.id, "Stopped by user");
    const run = await pending;

    expect(h.fetchSignals).toHaveLength(1);
    expect(h.fetchSignals[0]!.aborted).toBe(true);
    expect(run.status).toBe("cancelled");
    expect(run.cases.map((c) => c.status)).toEqual(["cancelled", "queued"]);
    expect(run.cases[0]!.output).toBe("{");
    const transitions = h.events
      .filter((e) => e.type === "run_status" || e.type === "case_status" || e.type === "case_result")
      .map((e) => (e.type === "case_result" ? `case:${e.result.status}` : e.type === "case_status" ? `case:${e.status}` : `run:${e.status}`));
    expect(transitions).toEqual(["run:running", "case:running", "case:cancelled", "run:cancelled"]);
  });

  it("does not send the API key anywhere but the API request", async () => {
    let header: string | null = null;
    mswServer.use(
      http.post(API_URL, ({ request }) => {
        header = request.headers.get("authorization");
        return sseResponse({ steps: [{ kind: "text", text: answer(0) }] });
      }),
    );
    const h = harness();
    const run = await h.start();
    expect(header).toBe("Bearer test-key");
    expect(JSON.stringify(run)).not.toContain("test-key");
    expect(JSON.stringify(h.events)).not.toContain("test-key");
  });
});
