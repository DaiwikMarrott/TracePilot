import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultModelSettings } from "../../../shared/defaults";
import { summarize } from "../../../shared/summary";
import type { CaseResult, Evaluation, Fixture, RunWithCases } from "../../../shared/types";
import { CompareView } from "./CompareView";

const fixture = (id: string): Fixture => ({
  id,
  split: "dev",
  ticket: { subject: `Subject ${id}`, body: "..." },
  expected: { category: "billing", urgency: "low" },
});

const evaluation = (passed: boolean): Evaluation => ({
  passed,
  predicted: { category: "billing", urgency: passed ? "low" : "high" },
  checks: [
    { name: "json_parse", status: "passed", detail: "ok" },
    { name: "urgency_match", status: passed ? "passed" : "failed", detail: passed ? "ok" : 'Predicted "high", expected "low".' },
  ],
});

const result = (runId: string, index: number, fixtureId: string, status: CaseResult["status"], passed?: boolean): CaseResult => ({
  runId,
  index,
  fixtureId,
  status,
  output: status === "queued" ? "" : '{"category":"billing"}',
  interrupted: false,
  evaluation: status === "completed" ? evaluation(passed!) : null,
  error: status === "cancelled" ? { kind: "cancelled", message: "Stopped by user" } : null,
  attemptLog: [],
  telemetry: { ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, requestId: null, messageId: null, servedModel: null, stopReason: null, attempts: 1 },
  startedAt: null,
  finishedAt: null,
});

const run = (id: string, version: number, cases: CaseResult[], hash = "abc123"): RunWithCases => ({
  id,
  promptVersionId: version,
  promptSnapshot: { version, label: `Label ${version}`, systemPrompt: "", userTemplate: "" },
  modelSettings: defaultModelSettings(),
  fixtureSelection: "dev",
  fixtureSnapshot: ["T1", "T2", "T3"].map(fixture),
  fixtureHash: hash,
  status: cases.some((c) => c.status === "queued") ? "cancelled" : "completed",
  statusReason: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  summary: summarize(cases),
  cases,
});

function mockRuns(a: RunWithCases, b: RunWithCases) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith(a.id) ? a : b), { status: 200 })),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("CompareView", () => {
  it("pairs cases by ticket, labels changes, and explains failed checks", async () => {
    mockRuns(
      run("a", 1, [result("a", 0, "T1", "completed", false), result("a", 1, "T2", "completed", true), result("a", 2, "T3", "completed", true)]),
      run("b", 2, [result("b", 0, "T1", "completed", true), result("b", 1, "T2", "completed", false), result("b", 2, "T3", "queued")]),
    );
    render(<CompareView a="a" b="b" onOpenRun={() => {}} />);

    const heading = await screen.findByRole("heading", { name: "Compare v1 and v2" });
    // Focus moves in an effect after the heading renders.
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/improved ·/).textContent).toMatch(/1 improved · 1 regressed · 0 pass in both · 0 fail in both · 1 incomplete/);

    const t1 = screen.getByRole("heading", { name: /T1 · Subject T1/ }).closest("li")!;
    expect(within(t1).getByText("improved")).toBeInTheDocument();
    expect(within(t1).getByText(/Predicted "high", expected "low"/)).toBeInTheDocument();
    const t3 = screen.getByRole("heading", { name: /T3/ }).closest("li")!;
    expect(within(t3).getByText("unfinished")).toBeInTheDocument();
  });

  it("warns when fixture snapshots differ and can hide cases that pass in both", async () => {
    const user = userEvent.setup();
    mockRuns(
      run("a", 1, [result("a", 0, "T1", "completed", true), result("a", 1, "T2", "completed", false)]),
      run("b", 2, [result("b", 0, "T1", "completed", true), result("b", 1, "T2", "completed", true)], "zzz999"),
    );
    render(<CompareView a="a" b="b" onOpenRun={() => {}} />);
    expect(await screen.findByRole("note")).toHaveTextContent(/different fixture snapshots/);
    await user.click(screen.getByLabelText("Hide cases that pass in both"));
    expect(screen.queryByRole("heading", { name: /T1 · Subject T1/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /T2 · Subject T2/ })).toBeInTheDocument();
  });

  it("compares latency and usage over completed cases, without inventing changes from unknown values", async () => {
    const withTelemetry = (r: CaseResult, t: Partial<CaseResult["telemetry"]>): CaseResult => ({ ...r, telemetry: { ...r.telemetry, ...t } });
    mockRuns(
      run("a", 1, [
        withTelemetry(result("a", 0, "T1", "completed", false), { ttftMs: 1000, durationMs: 1200, inputTokens: 100, outputTokens: 20 }),
        withTelemetry(result("a", 1, "T2", "completed", true), { ttftMs: 2000, durationMs: 2200, inputTokens: 100, outputTokens: null }),
      ]),
      run("b", 2, [
        withTelemetry(result("b", 0, "T1", "completed", true), { ttftMs: 500, durationMs: 600, inputTokens: 280, outputTokens: 18 }),
        withTelemetry(result("b", 1, "T2", "completed", true), { ttftMs: 700, durationMs: 800, inputTokens: 280, outputTokens: 22 }),
      ]),
    );
    render(<CompareView a="a" b="b" onOpenRun={() => {}} />);
    const table = await screen.findByRole("table", { name: /Latency and usage over completed cases \(A: 2, B: 2\)/ });
    const row = (name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!;
    expect(row("Median time to first text")).toHaveTextContent(/1\.50 s600 ms-60%/);
    expect(row("Mean input tokens per case")).toHaveTextContent(/100280\+180%/);
    expect(row("Mean output tokens per case")).toHaveTextContent(/20 \(1 unknown\)20—/);
  });
});
