import { Router } from "express";
import { TICKETS } from "../../fixtures/tickets";
import type { Fixture, FixtureSelection } from "../../shared/types";
import type { Repository } from "../db/repository";
import type { RunManager } from "../runner/runManager";
import { streamRun } from "./stream";
import { createRunSchema, HttpError, parseBody } from "./validation";

export function selectFixtures(selection: FixtureSelection, all: Fixture[] = TICKETS): Fixture[] {
  return selection === "all" ? all : all.filter((f) => f.split === selection);
}

export function runRoutes(repo: Repository, manager: RunManager, options: { liveAvailable: boolean }) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(repo.listRuns());
  });

  router.get("/:id", (req, res) => {
    const run = repo.getRunWithCases(req.params.id);
    if (!run) throw new HttpError(404, "Run not found");
    res.json(run);
  });

  router.post("/", (req, res) => {
    const input = parseBody(createRunSchema, req.body);
    const prompt = repo.getPromptVersion(input.promptVersionId);
    if (!prompt) throw new HttpError(400, `Prompt version ${input.promptVersionId} does not exist`);
    if (input.modelSettings.provider === "anthropic" && !options.liveAvailable) {
      throw new HttpError(400, "Live mode needs ANTHROPIC_API_KEY on the server. Use the mock provider instead.");
    }
    const activeId = manager.activeRunId();
    if (activeId) throw new HttpError(409, "Another run is in progress. Stop it or wait for it to finish.");
    const run = repo.createRun({
      prompt,
      modelSettings: input.modelSettings,
      fixtureSelection: input.fixtureSelection,
      fixtures: structuredClone(selectFixtures(input.fixtureSelection)),
    });
    res.status(201).json(run);
  });

  router.get("/:id/stream", streamRun(repo, manager));

  router.post("/:id/cancel", (req, res) => {
    const run = repo.getRun(req.params.id);
    if (!run) throw new HttpError(404, "Run not found");
    if (manager.cancel(run.id, "Stopped by user")) {
      res.status(202).json({ ok: true });
      return;
    }
    if (run.status === "queued") {
      // Never started: record the cancellation directly.
      repo.setRunStatus(run.id, "cancelled", "Stopped by user before it started");
      res.status(200).json({ ok: true });
      return;
    }
    throw new HttpError(409, `Run is already ${run.status}`);
  });

  return router;
}
