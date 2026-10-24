import { Router } from "express";
import type { Repository } from "../db/repository";
import { createPromptVersionSchema, HttpError, parseBody } from "./validation";

export function promptRoutes(repo: Repository) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(repo.listPromptVersions());
  });

  // There is intentionally no PUT/PATCH: an edit is saved as a new version.
  router.post("/", (req, res) => {
    const input = parseBody(createPromptVersionSchema, req.body);
    if (input.parentId !== null && !repo.getPromptVersion(input.parentId)) {
      throw new HttpError(400, `Parent version ${input.parentId} does not exist`);
    }
    res.status(201).json(repo.createPromptVersion(input));
  });

  return router;
}
