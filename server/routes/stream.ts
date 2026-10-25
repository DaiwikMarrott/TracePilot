import type { Request, Response } from "express";
import type { RunEvent } from "../../shared/types";
import type { Repository } from "../db/repository";
import type { RunManager } from "../runner/runManager";

const HEARTBEAT_MS = 15_000;

function writeEvent(res: Response, event: RunEvent) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * GET /api/runs/:id/stream — server-sent events for one run.
 *
 * Opening the stream for a queued run starts it, so execution is tied to an
 * observer. When the last observer disconnects, the run is cancelled and the
 * in-flight Claude request is aborted.
 */
export function streamRun(repo: Repository, manager: RunManager) {
  return (req: Request, res: Response) => {
    const runId = String(req.params.id);
    const run = repo.getRunWithCases(runId);
    if (!run) {
      res.status(404).json({ error: { message: "Run not found" } });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    // Tell EventSource not to reconnect quickly after we end a finished stream.
    res.write("retry: 60000\n\n");
    writeEvent(res, { type: "snapshot", run });

    const terminal = run.status !== "queued" && run.status !== "running";
    if (terminal || (run.status === "running" && !manager.isActive(runId))) {
      writeEvent(res, { type: "run_end", run: repo.getRun(runId)! });
      res.end();
      return;
    }

    if (run.status === "queued" && manager.activeRunId() && !manager.isActive(runId)) {
      writeEvent(res, { type: "run_status", runId, status: "queued", reason: "Waiting: another run is in progress" });
      res.end();
      return;
    }

    let ended = false;
    const send = (event: RunEvent) => {
      if (ended) return;
      writeEvent(res, event);
      if (event.type === "run_end") {
        ended = true;
        res.end();
      }
    };

    let detach: () => void;
    if (run.status === "queued") {
      try {
        manager.start(runId, send).catch((err) => console.error(err));
      } catch (err) {
        writeEvent(res, { type: "run_status", runId, status: "queued", reason: (err as Error).message });
        res.end();
        return;
      }
      detach = () => manager.unsubscribe(runId, send);
    } else {
      detach = manager.subscribe(runId, send);
    }

    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
    res.on("close", () => {
      clearInterval(heartbeat);
      detach();
      if (!ended && manager.isActive(runId) && manager.listenerCount(runId) === 0) {
        manager.cancel(runId, "Client disconnected");
      }
    });
  };
}
