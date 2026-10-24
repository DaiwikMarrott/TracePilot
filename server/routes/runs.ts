import { Router } from "express";
import { TICKETS } from "../../fixtures/tickets";
import type { Fixture, FixtureSelection } from "../../shared/types";
import type { Repository } from "../db/repository";
import { createRunSchema, HttpError, parseBody } from "./validation";

export function selectFixtures(selection: FixtureSelection, all: Fixture[] = TICKETS): Fixture[] {
  return selection === "all" ? all : all.filter((f) => f.split === selection);
}

export function runRoutes(repo: Repository, options: { liveAvailable: boolean }) {
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
    const run = repo.createRun({
      prompt,
      modelSettings: input.modelSettings,
      fixtureSelection: input.fixtureSelection,
      fixtures: structuredClone(selectFixtures(input.fixtureSelection)),
    });
    res.status(201).json(run);
  });

  return router;
}
