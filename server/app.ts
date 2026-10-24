import express from "express";
import type { HealthResponse } from "../shared/types";
import type { ServerConfig } from "./config";

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      liveAvailable: config.apiKey !== null,
      defaultModel: config.defaultModel,
      activeRunId: null,
    };
    res.json(body);
  });

  return app;
}
