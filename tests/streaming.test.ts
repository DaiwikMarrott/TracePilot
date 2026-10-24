import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "../server/provider/mock";
import type { Provider } from "../server/provider/types";
import { RunManager } from "../server/runner/runManager";
import { defaultModelSettings } from "../shared/defaults";
import type { RunEvent, RunWithCases } from "../shared/types";
import { readSse, startTestServer, waitFor, type TestServer } from "./helpers";

let server: TestServer;
afterEach(() => server?.close());

async function createRun(s: TestServer, overrides: Partial<ReturnType<typeof defaultModelSettings>> = {}) {
  const res = await s.json<RunWithCases>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      promptVersionId: 2,
      fixtureSelection: "dev",
      modelSettings: { ...defaultModelSettings(), ...overrides },
    }),
  });
  expect(res.status).toBe(201);
  return res.body;
}

/** Wraps a provider to observe whether upstream requests saw the abort. */
function spyProvider(inner: Provider) {
  const signals: AbortSignal[] = [];
  const provider: Provider = {
    name: inner.name,
    stream: (req, cb, signal) => {
      signals.push(signal);
      return inner.stream(req, cb, signal);
    },
  };
  return { provider, signals };
}

describe("run streaming over SSE", () => {
  it("streams deltas and records every case with explicit state transitions", async () => {
    server = await startTestServer();
    const run = await createRun(server);
    const events: RunEvent[] = [];
    for await (const event of readSse(`${server.url}/api/runs/${run.id}/stream`)) events.push(event);

    expect(events[0]!.type).toBe("snapshot");
    const runStatuses = events.filter((e) => e.type === "run_status").map((e) => e.status);
    expect(runStatuses).toEqual(["running", "completed"]);
    expect(events.filter((e) => e.type === "case_delta").length).toBeGreaterThan(8);
    expect(events.filter((e) => e.type === "case_result")).toHaveLength(8);
    expect(events.at(-1)).toMatchObject({ type: "run_end", run: { status: "completed" } });

    // Deltas reassemble into the recorded output.
    const streamed = events
      .filter((e) => e.type === "case_delta" && e.index === 0)
      .map((e) => (e.type === "case_delta" ? e.text : ""))
      .join("");
    const stored = server.repo.getRunWithCases(run.id)!;
    expect(stored.cases[0]!.output).toBe(streamed);
    expect(stored.cases.every((c) => c.status === "completed")).toBe(true);
  });

  it("replays a finished run as a snapshot and ends the stream", async () => {
    server = await startTestServer();
    const run = await createRun(server);
    for await (const _ of readSse(`${server.url}/api/runs/${run.id}/stream`)) void _;
    const replay: RunEvent[] = [];
    for await (const event of readSse(`${server.url}/api/runs/${run.id}/stream`)) replay.push(event);
    expect(replay.map((e) => e.type)).toEqual(["snapshot", "run_end"]);
  });

  it("refuses to start a second run while one is active", async () => {
    server = await startTestServer({}, {
      manager: (repo) => new RunManager({ repo, providers: { mock: new MockProvider({ chunkDelayMs: 20 }) } }),
    });
    const run = await createRun(server);
    const controller = new AbortController();
    const reading = (async () => {
      for await (const _ of readSse(`${server.url}/api/runs/${run.id}/stream`, controller.signal)) void _;
    })().catch(() => {});
    await waitFor(() => server.manager.isActive(run.id));
    const second = await server.json<{ error: { message: string } }>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ promptVersionId: 1, fixtureSelection: "dev", modelSettings: defaultModelSettings() }),
    });
    expect(second.status).toBe(409);
    controller.abort();
    await reading;
  });

  it("Stop aborts the upstream request, keeps partial output, and records cancelled state", async () => {
    const { provider, signals } = spyProvider(new MockProvider({ chunkDelayMs: 15 }));
    server = await startTestServer({}, { manager: (repo) => new RunManager({ repo, providers: { mock: provider } }) });
    const run = await createRun(server);

    const events: RunEvent[] = [];
    for await (const event of readSse(`${server.url}/api/runs/${run.id}/stream`)) {
      events.push(event);
      // Stop in the middle of the second case's response.
      if (event.type === "case_delta" && event.index === 1 && events.filter((e) => e.type === "case_delta" && e.index === 1).length === 2) {
        const res = await fetch(`${server.url}/api/runs/${run.id}/cancel`, { method: "POST" });
        expect(res.status).toBe(202);
      }
    }

    expect(signals[1]!.aborted).toBe(true);
    expect(signals).toHaveLength(2); // no further cases were sent upstream
    const stored = server.repo.getRunWithCases(run.id)!;
    expect(stored.status).toBe("cancelled");
    expect(stored.statusReason).toBe("Stopped by user");
    expect(stored.cases[0]!.status).toBe("completed");
    expect(stored.cases[1]!.status).toBe("cancelled");
    expect(stored.cases[1]!.output.length).toBeGreaterThan(0);
    expect(stored.cases[1]!.error).toMatchObject({ kind: "cancelled" });
    expect(stored.cases.slice(2).every((c) => c.status === "queued")).toBe(true);
    expect(stored.summary).toMatchObject({ cancelled: 1, unfinished: 6 });
    expect(events.at(-1)).toMatchObject({ type: "run_end", run: { status: "cancelled" } });
  });

  it("cancels the run when the only client disconnects", async () => {
    const { provider, signals } = spyProvider(new MockProvider({ chunkDelayMs: 15 }));
    server = await startTestServer({}, { manager: (repo) => new RunManager({ repo, providers: { mock: provider } }) });
    const run = await createRun(server);
    const controller = new AbortController();
    try {
      for await (const event of readSse(`${server.url}/api/runs/${run.id}/stream`, controller.signal)) {
        if (event.type === "case_delta") controller.abort();
      }
    } catch {
      // the aborted fetch rejects
    }
    await waitFor(() => server.repo.getRun(run.id)!.status === "cancelled");
    expect(signals[0]!.aborted).toBe(true);
    expect(server.repo.getRun(run.id)!.statusReason).toBe("Client disconnected");
  });
});
