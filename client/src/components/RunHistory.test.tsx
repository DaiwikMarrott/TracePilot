import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultModelSettings } from "../../../shared/defaults";
import type { ProviderName, Run, RunStatus } from "../../../shared/types";
import { RunHistory } from "./RunHistory";

const run = (id: string, version: number, provider: ProviderName, status: RunStatus): Run => ({
  id,
  promptVersionId: version,
  promptSnapshot: { version, label: `Label ${version}`, systemPrompt: "", userTemplate: "" },
  modelSettings: { ...defaultModelSettings(), provider },
  fixtureSelection: "dev",
  fixtureSnapshot: [],
  fixtureHash: "abc123",
  status,
  statusReason: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  summary: { total: 0, passed: 0, failed: 0, errored: 0, cancelled: 0, unfinished: 0 },
});

const runs = [
  run("r1", 1, "mock", "completed"),
  run("r2", 2, "google", "completed"),
  run("r3", 2, "google", "failed"),
  run("r4", 3, "mock", "cancelled"),
];

function renderHistory(selected: string[] = []) {
  render(<RunHistory runs={runs} selected={selected} onToggle={vi.fn()} onOpen={vi.fn()} onCompare={vi.fn()} />);
  return () => screen.getAllByRole("row").slice(1); // skip the header row
}

describe("RunHistory filters", () => {
  it("offers only values that occur and combines filters", async () => {
    const user = userEvent.setup();
    const rows = renderHistory();
    const provider = screen.getByRole("combobox", { name: "Provider" });
    expect(within(provider).getAllByRole("option").map((o) => o.textContent)).toEqual(["All providers", "Gemini API", "Mock"]);

    await user.selectOptions(provider, "google");
    expect(rows()).toHaveLength(2);
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "failed");
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 4 runs")).toHaveAttribute("role", "status");

    await user.selectOptions(screen.getByRole("combobox", { name: "Prompt" }), "1");
    expect(screen.getByText("No runs match these filters.")).toBeInTheDocument();
  });

  it("keeps a selection that a filter hides, and says so", async () => {
    const user = userEvent.setup();
    renderHistory(["r1", "r2"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "google");
    expect(screen.getByText(/2\/2 selected \(1 hidden by filters\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare selected" })).toBeEnabled();
  });
});
