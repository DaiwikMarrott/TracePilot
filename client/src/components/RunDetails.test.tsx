import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultModelSettings } from "../../../shared/defaults";
import { summarize } from "../../../shared/summary";
import type { CaseResult, RunWithCases } from "../../../shared/types";
import { RunDetails } from "./RunDetails";

const base: Omit<CaseResult, "index" | "fixtureId"> = {
  runId: "r",
  status: "completed",
  output: "{}",
  interrupted: false,
  evaluation: { passed: true, checks: [], predicted: { category: "billing", urgency: "low" } },
  error: null,
  attemptLog: [],
  telemetry: { ttftMs: 820, durationMs: 1430, inputTokens: 210, outputTokens: 18, requestId: "req_1", messageId: "msg_1", servedModel: "claude-opus-5-5", stopReason: "end_turn", attempts: 1 },
  startedAt: "2026-10-23T12:00:00.000Z",
  finishedAt: "2026-10-23T12:00:01.430Z",
};

const cases: CaseResult[] = [
  { ...base, index: 0, fixtureId: "T01" },
  {
    ...base,
    index: 1,
    fixtureId: "T02",
    status: "failed",
    interrupted: true,
    output: '{"category": "acc',
    evaluation: null,
    error: { kind: "stream_interrupted", message: "Stream failed: socket hang up" },
    attemptLog: [
      { attempt: 1, startedAt: "2026-10-23T12:00:02.000Z", outcome: "error", errorKind: "rate_limit", message: "429", requestId: "req_429", retryDelayMs: 500 },
      { attempt: 2, startedAt: "2026-10-23T12:00:02.500Z", outcome: "error", errorKind: "stream_interrupted", message: "socket hang up", requestId: "req_2" },
    ],
    telemetry: { ...base.telemetry, inputTokens: null, outputTokens: null, requestId: "req_2", stopReason: null, durationMs: 6100, attempts: 2 },
  },
];

const run: RunWithCases = {
  id: "r",
  promptVersionId: 2,
  promptSnapshot: { version: 2, label: "Strict", systemPrompt: "SYSTEM TEXT", userTemplate: "{{body}}" },
  modelSettings: { ...defaultModelSettings(), provider: "anthropic" },
  fixtureSelection: "dev",
  fixtureSnapshot: [],
  fixtureHash: "abcdef0123456789",
  status: "completed",
  statusReason: null,
  createdAt: "2026-10-23T12:00:00.000Z",
  startedAt: "2026-10-23T12:00:00.000Z",
  finishedAt: "2026-10-23T12:00:08.000Z",
  summary: summarize(cases),
  cases,
};

afterEach(() => vi.unstubAllGlobals());

describe("RunDetails", () => {
  it("connects telemetry to the recorded prompt and settings, keeping unknown usage explicit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(run))));
    render(<RunDetails id="r" />);
    const heading = await screen.findByRole("heading", { name: /Run details: v2 — Strict/ });
    // Focus moves in an effect after the heading renders.
    await waitFor(() => expect(heading).toHaveFocus());

    expect(screen.getByText("claude-opus-5-5", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("SYSTEM TEXT")).toBeInTheDocument();
    // One case did not report usage, so the total is a lower bound, not a fabricated sum.
    expect(screen.getByText("≥ 210 (1 unknown)")).toBeInTheDocument();
    expect(screen.getByText("Slowest case").nextElementSibling).toHaveTextContent("T02: 6.10 s");

    const table = screen.getByRole("table", { name: /Timing, usage and identifiers/ });
    const t02 = within(table).getByRole("row", { name: /T02/ });
    expect(within(t02).getByText("unknown / unknown")).toBeInTheDocument();
    expect(within(t02).getByText("interrupted")).toBeInTheDocument();
    expect(within(t02).getByText("req_2")).toBeInTheDocument();
    expect(screen.getByText(/partial output above was preserved/)).toBeInTheDocument();
    expect(screen.getByText(/rate_limit: 429/)).toHaveTextContent("retried after 500 ms");
  });
});
