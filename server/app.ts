import express from "express";
import { TICKETS } from "../fixtures/tickets";
import type { HealthResponse } from "../shared/types";
import type { ServerConfig } from "./config";
import type { Repository } from "./db/repository";
import type { RunManager } from "./runner/runManager";
import { promptRoutes } from "./routes/prompts";
import { runRoutes } from "./routes/runs";
import { errorHandler } from "./routes/validation";

export interface AppDeps {
  config: ServerConfig;
  repo: Repository;
  manager: RunManager;
}

export function createApp({ config, repo, manager }: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      liveAvailable: config.apiKey !== null,
      defaultModel: config.defaultModel,
      activeRunId: manager.activeRunId(),
    };
    res.json(body);
  });

  app.get("/api/fixtures", (_req, res) => {
    res.json(TICKETS);
  });
  app.use("/api/prompts", promptRoutes(repo));
  app.use("/api/runs", runRoutes(repo, manager, { liveAvailable: config.apiKey !== null }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { message: "Not found" } });
  });
  app.use(errorHandler);

  return app;
}
