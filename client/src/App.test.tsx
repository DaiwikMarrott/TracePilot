import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_PROMPTS } from "../../fixtures/prompts";
import { TICKETS } from "../../fixtures/tickets";
import { defaultModelSettings } from "../../shared/defaults";
import { summarize } from "../../shared/summary";
import type { CaseResult, PromptVersion, Run, RunEvent, RunWithCases } from "../../shared/types";
import { App } from "./App";

// jsdom has no EventSource; this fake lets the test push server events.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  push(event: RunEvent) {
    act(() => {
      for (const fn of this.listeners.get(event.type) ?? []) fn(new MessageEvent(event.type, { data: JSON.stringify(event) }));
    });
  }
}

const versions: PromptVersion[] = SEED_PROMPTS.map((p, i) => ({
  ...p,
  id: i + 1,
  version: i + 1,
  parentId: i === 0 ? null : i,
  createdAt: "2026-10-20T00:00:00.000Z",
}));
const fixtures = TICKETS.slice(0, 2);

const queuedCase = (index: number): CaseResult => ({
  runId: "run-1",
  index,
  fixtureId: fixtures[index]!.id,
  status: "queued",
  output: "",
  interrupted: false,
  evaluation: null,
  error: null,
  attemptLog: [],
  telemetry: { ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, requestId: null, messageId: null, servedModel: null, stopReason: null, attempts: 0 },
  startedAt: null,
  finishedAt: null,
});

const newRun = (id: string): RunWithCases => {
  const cases = [queuedCase(0), queuedCase(1)].map((c) => ({ ...c, runId: id }));
  return {
    id,
    promptVersionId: 2,
    promptSnapshot: { version: 2, label: versions[1]!.label, systemPrompt: versions[1]!.systemPrompt, userTemplate: versions[1]!.userTemplate },
    modelSettings: defaultModelSettings(),
    fixtureSelection: "dev",
    fixtureSnapshot: fixtures,
    fixtureHash: "hash01",
    status: "queued",
    statusReason: null,
    createdAt: "2026-10-23T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    summary: summarize(cases),
    cases,
  };
};

let history: Run[];
const calls: { method: string; url: string; body?: unknown }[] = [];

beforeEach(() => {
  history = [];
  calls.length = 0;
  FakeEventSource.instances = [];
  window.location.hash = "";
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url === "/api/health") return json({ ok: true, liveAvailable: false, defaultModel: "claude-opus-5-5", activeRunId: null });
      if (url === "/api/prompts") return json(versions);
      if (url === "/api/fixtures") return json(fixtures);
      if (url === "/api/runs" && method === "GET") return json(history);
      if (url === "/api/runs" && method === "POST") {
        const run = newRun(`run-${history.length + 1}`);
        history = [run, ...history];
        return json(run, 201);
      }
      if (url.endsWith("/cancel")) return json({ ok: true }, 202);
      return json({ error: { message: "not found" } }, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** Presses Tab until `target` has focus, failing if it is not reachable. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement, max = 40) {
  for (let i = 0; i < max && document.activeElement !== target; i++) await user.tab();
  expect(target).toHaveFocus();
}

describe("primary workflow, keyboard only", () => {
  it("starts an evaluation, follows progress, and stops it without a mouse", async () => {
    const user = userEvent.setup();
    render(<App />);
    const start = await screen.findByRole("button", { name: "Start evaluation of v2" });

    await tabTo(user, start);
    await user.keyboard("{Enter}");
    expect(calls.find((c) => c.method === "POST" && c.url === "/api/runs")?.body).toMatchObject({
      promptVersionId: 2,
      fixtureSelection: "dev",
      modelSettings: { provider: "mock" },
    });

    const source = FakeEventSource.instances.at(-1)!;
    expect(source.url).toBe("/api/runs/run-1/stream");
    const run = newRun("run-1");
    source.push({ type: "snapshot", run });
    source.push({ type: "run_status", runId: run.id, status: "running", reason: null });
    source.push({ type: "case_status", runId: run.id, index: 0, status: "running" });
    source.push({ type: "case_delta", runId: run.id, index: 0, text: '{"category":' });

    const status = screen.getAllByRole("status").find((el) => el.textContent?.includes("Case 1 of 2"));
    expect(status).toBeDefined();
    expect(screen.getByLabelText(`Response for ${fixtures[0]!.id}`)).toHaveTextContent('{"category":');

    const stop = screen.getByRole("button", { name: "Stop" });
    await tabTo(user, stop);
    await user.keyboard("{Enter}");
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/runs/run-1/cancel")).toBe(true);

    source.push({ type: "run_status", runId: run.id, status: "cancelled", reason: "Stopped by user" });
    source.push({ type: "run_end", run: { ...run, status: "cancelled", statusReason: "Stopped by user" } });
    expect(screen.getAllByRole("status").some((el) => /Run cancelled — Stopped by user/.test(el.textContent ?? ""))).toBe(true);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("selects two runs and opens the comparison with the keyboard", async () => {
    history = [
      { ...newRun("run-b"), status: "completed" },
      { ...newRun("run-a"), status: "completed" },
    ];
    const user = userEvent.setup();
    render(<App />);
    const historyLink = await screen.findByRole("link", { name: "Run history" });
    await tabTo(user, historyLink);
    await user.keyboard("{Enter}");
    // jsdom does not follow hash links on Enter; apply what the browser would.
    act(() => {
      window.location.hash = historyLink.getAttribute("href")!;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const boxes = await screen.findAllByRole("checkbox", { name: /Select v2 run/ });
    for (const box of boxes) {
      await tabTo(user, box);
      await user.keyboard(" ");
    }
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    const compare = screen.getByRole("button", { name: "Compare selected" });
    await tabTo(user, compare);
    await user.keyboard("{Enter}");
    expect(window.location.hash).toBe("#/compare/run-b/run-a");
  });

  it("gives every control an accessible name", async () => {
    const { container } = render(<App />);
    await screen.findByRole("button", { name: /Start evaluation/ });
    const controls = container.querySelectorAll("input, select, textarea, button, a[href]");
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) expect(control).toHaveAccessibleName();
  });

  it("explains an unreachable server in a status message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    render(<App />);
    expect(await screen.findByText(/The API server is not reachable \(Failed to fetch\)/)).toHaveAttribute("role", "status");
  });
});
