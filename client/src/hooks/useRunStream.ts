import { useEffect, useReducer } from "react";
import type { CaseResult, RunEvent, RunStatus, RunWithCases } from "../../../shared/types";
import { summarize } from "../../../shared/summary";

export interface LiveRun {
  run: RunWithCases | null;
  /** Human-readable connection or retry notice, announced to screen readers. */
  notice: string | null;
  connection: "idle" | "connecting" | "open" | "closed" | "error";
}

type Action = { type: "event"; event: RunEvent } | { type: "connection"; state: LiveRun["connection"] } | { type: "reset" };

function updateCase(run: RunWithCases, index: number, patch: (c: CaseResult) => CaseResult): RunWithCases {
  const cases = run.cases.map((c) => (c.index === index ? patch(c) : c));
  return { ...run, cases, summary: summarize(cases) };
}

export function reduceRunEvent(state: LiveRun, action: Action): LiveRun {
  if (action.type === "reset") return { run: null, notice: null, connection: "idle" };
  if (action.type === "connection") return { ...state, connection: action.state };
  const { event } = action;
  if (event.type === "snapshot") return { ...state, run: event.run, connection: "open" };
  const run = state.run;
  if (!run) return state;
  switch (event.type) {
    case "run_status":
      return {
        ...state,
        run: { ...run, status: event.status as RunStatus, statusReason: event.reason },
        notice: event.reason,
      };
    case "case_status":
      return {
        ...state,
        run: updateCase(run, event.index, (c) => ({ ...c, status: event.status, output: "" })),
        notice: null,
      };
    case "case_retry":
      return {
        ...state,
        run: updateCase(run, event.index, (c) => ({ ...c, output: "" })),
        notice: `Case ${event.index + 1}: ${event.errorKind.replace("_", " ")} — retrying (attempt ${event.attempt + 1}) in ${Math.round(event.delayMs)} ms`,
      };
    case "case_delta":
      return { ...state, run: updateCase(run, event.index, (c) => ({ ...c, output: c.output + event.text })) };
    case "case_result":
      return { ...state, run: updateCase(run, event.result.index, () => event.result) };
    case "run_end":
      return { ...state, run: { ...run, ...event.run }, connection: "closed" };
  }
}

/** Subscribes to /api/runs/:id/stream. Opening it starts a queued run; closing it cancels the run server-side. */
export function useRunStream(runId: string | null, onEnd?: () => void): LiveRun {
  const [state, dispatch] = useReducer(reduceRunEvent, { run: null, notice: null, connection: "idle" });

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;
    dispatch({ type: "connection", state: "connecting" });
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    const types: RunEvent["type"][] = ["snapshot", "run_status", "case_status", "case_retry", "case_delta", "case_result", "run_end"];
    const handle = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as RunEvent;
      dispatch({ type: "event", event });
      if (event.type === "run_end") {
        source.close();
        onEnd?.();
      }
    };
    for (const t of types) source.addEventListener(t, handle as EventListener);
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) dispatch({ type: "connection", state: "error" });
    };
    return () => source.close();
    // onEnd is intentionally excluded: a new callback identity must not reopen the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return state;
}
