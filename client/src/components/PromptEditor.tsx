import { useId, useState } from "react";
import type { CreatePromptVersionRequest, PromptVersion } from "../../../shared/types";
import { errorMessage } from "../api";

interface Props {
  versions: PromptVersion[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSave: (input: CreatePromptVersionRequest) => Promise<PromptVersion>;
}

export function PromptEditor({ versions, selectedId, onSelect, onSave }: Props) {
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  return (
    <section aria-labelledby="prompt-editor-heading" className="panel">
      <h2 id="prompt-editor-heading">Prompt</h2>
      <label className="field">
        <span>Prompt version</span>
        <select value={selectedId ?? ""} onChange={(e) => onSelect(Number(e.target.value))}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} — {v.label}
            </option>
          ))}
        </select>
      </label>
      {/* Keyed by version so switching versions resets the draft. */}
      {selected && <Draft key={selected.id} base={selected} onSave={onSave} onSaved={(v) => onSelect(v.id)} />}
    </section>
  );
}

function Draft({
  base,
  onSave,
  onSaved,
}: {
  base: PromptVersion;
  onSave: Props["onSave"];
  onSaved: (v: PromptVersion) => void;
}) {
  const [label, setLabel] = useState(base.label);
  const [systemPrompt, setSystemPrompt] = useState(base.systemPrompt);
  const [userTemplate, setUserTemplate] = useState(base.userTemplate);
  const [status, setStatus] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const hintId = useId();

  const dirty = systemPrompt !== base.systemPrompt || userTemplate !== base.userTemplate || label !== base.label;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const created = await onSave({ label, systemPrompt, userTemplate, parentId: base.id });
      setStatus({ tone: "info", text: `Saved as v${created.version}. v${base.version} is unchanged.` });
      onSaved(created);
    } catch (err) {
      setStatus({ tone: "error", text: `Could not save: ${errorMessage(err)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <p className="muted">
        v{base.version} created {new Date(base.createdAt).toLocaleString()}
        {base.parentId !== null && ` · derived from version id ${base.parentId}`}
      </p>
      <label className="field">
        <span>Version label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required />
      </label>
      <label className="field">
        <span>System prompt</span>
        <textarea rows={12} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} required />
      </label>
      <label className="field">
        <span>User message template</span>
        <textarea
          rows={4}
          value={userTemplate}
          onChange={(e) => setUserTemplate(e.target.value)}
          aria-describedby={hintId}
          required
        />
      </label>
      <p id={hintId} className="muted">
        Use {"{{subject}}"} and {"{{body}}"} to insert the ticket.
      </p>
      <div className="row">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save as new version"}
        </button>
        {dirty && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setLabel(base.label);
              setSystemPrompt(base.systemPrompt);
              setUserTemplate(base.userTemplate);
            }}
          >
            Discard changes
          </button>
        )}
        <span className="muted">{dirty ? "Unsaved changes" : "No changes"}</span>
      </div>
      <p role={status?.tone === "error" ? "alert" : "status"} className={status?.tone === "error" ? "error" : ""}>
        {status?.text}
      </p>
    </form>
  );
}
