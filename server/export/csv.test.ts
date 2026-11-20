import { describe, expect, it } from "vitest";
import { TICKETS } from "../../fixtures/tickets";
import { defaultModelSettings } from "../../shared/defaults";
import { summarize } from "../../shared/summary";
import type { CaseResult, RunWithCases } from "../../shared/types";
import { csvCell, runToCsv } from "./csv";

const telemetry = { ttftMs: 812.4, durationMs: 1430.6, inputTokens: 210, outputTokens: null, requestId: "req_1", messageId: null, servedModel: "m", stopReason: "end_turn", attempts: 1 };
const fixture = TICKETS[0]!;

const passed: CaseResult = {
  runId: "r1",
  index: 0,
  fixtureId: fixture.id,
  status: "completed",
  output: "{}",
  interrupted: false,
  evaluation: { passed: false, checks: [{ name: "urgency_match", status: "failed", detail: "x" }], predicted: { category: "billing", urgency: "high" } },
  error: null,
  attemptLog: [],
  telemetry,
  startedAt: null,
  finishedAt: null,
};
const errored: CaseResult = {
  ...passed,
  index: 1,
  status: "failed",
  evaluation: null,
  interrupted: true,
  error: { kind: "stream_interrupted", message: 'Stream failed: "socket", hang up' },
  telemetry: { ...telemetry, inputTokens: null, ttftMs: null },
};

const run: RunWithCases = {
  id: "r1",
  promptVersionId: 2,
  promptSnapshot: { version: 2, label: "Strict, v2", systemPrompt: "s", userTemplate: "{{body}}" },
  modelSettings: { ...defaultModelSettings(), provider: "anthropic" },
  fixtureSelection: "dev",
  fixtureSnapshot: [fixture],
  fixtureHash: "abc",
  status: "completed",
  statusReason: null,
  createdAt: "",
  startedAt: null,
  finishedAt: null,
  summary: summarize([passed, errored]),
  cases: [passed, errored],
};

describe("csvCell", () => {
  it("quotes separators and quotes, and leaves unknown values empty", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });

  it("neutralises text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell(-1)).toBe("-1");
  });
});

describe("runToCsv", () => {
  it("writes one row per case with recorded inputs, outcomes and telemetry", () => {
    const lines = runToCsv(run).trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    const header = lines[0]!.split(",");
    const first = Object.fromEntries(header.map((h, i) => [h, lines[1]!.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[i]]));
    expect(first).toMatchObject({
      prompt_label: '"Strict, v2"',
      fixture_id: fixture.id,
      expected_category: fixture.expected.category,
      predicted_urgency: "high",
      outcome: "failed",
      failed_checks: "urgency_match",
      ttft_ms: "812",
      input_tokens: "210",
      output_tokens: "", // unknown stays empty, not 0
    });
    expect(lines[2]).toContain(',errored,true,,stream_interrupted,"Stream failed: ""socket"", hang up",');
  });
});
