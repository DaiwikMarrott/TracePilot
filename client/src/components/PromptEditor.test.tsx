import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CreatePromptVersionRequest, PromptVersion } from "../../../shared/types";
import { PromptEditor } from "./PromptEditor";

const v1: PromptVersion = {
  id: 1,
  version: 1,
  label: "Baseline",
  systemPrompt: "Classify tickets.",
  userTemplate: "{{body}}",
  parentId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

function Harness({ onSave }: { onSave: (input: CreatePromptVersionRequest) => void }) {
  const [versions, setVersions] = useState([v1]);
  const [selected, setSelected] = useState(1);
  return (
    <PromptEditor
      versions={versions}
      selectedId={selected}
      onSelect={setSelected}
      onSave={async (input) => {
        onSave(input);
        const created = { ...input, id: 2, version: 2, createdAt: "2026-10-02T00:00:00.000Z" };
        setVersions((vs) => [...vs, created]);
        return created;
      }}
    />
  );
}

describe("PromptEditor", () => {
  it("saves an edit as a new version derived from the selected one", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    const save = screen.getByRole("button", { name: "Save as new version" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("System prompt"), " Respond with JSON.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith({
      label: "Baseline",
      systemPrompt: "Classify tickets. Respond with JSON.",
      userTemplate: "{{body}}",
      parentId: 1,
    });
    expect(screen.getByLabelText("Prompt version")).toHaveDisplayValue("v2 — Baseline");
    // The selector still offers the original, unchanged version.
    expect(screen.getByRole("option", { name: "v1 — Baseline" })).toBeInTheDocument();
  });

  it("reports save failures in an alert", async () => {
    const user = userEvent.setup();
    render(
      <PromptEditor
        versions={[v1]}
        selectedId={1}
        onSelect={() => {}}
        onSave={() => Promise.reject(new Error("disk full"))}
      />,
    );
    await user.type(screen.getByLabelText("Version label"), "!");
    await user.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save: disk full");
  });
});
