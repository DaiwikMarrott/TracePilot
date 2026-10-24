import type { Server } from "node:http";
import { SEED_PROMPTS } from "../fixtures/prompts";
import { createApp, type AppDeps } from "../server/app";
import type { ServerConfig } from "../server/config";
import { openDatabase } from "../server/db/database";
import { Repository } from "../server/db/repository";

export interface TestServer {
  url: string;
  repo: Repository;
  close: () => Promise<void>;
  json: <T>(path: string, init?: RequestInit) => Promise<{ status: number; body: T }>;
}

export async function startTestServer(
  overrides: Partial<ServerConfig> = {},
  extra: Partial<Omit<AppDeps, "config" | "repo">> = {},
): Promise<TestServer> {
  const config: ServerConfig = { port: 0, dbPath: ":memory:", apiKey: null, defaultModel: "claude-opus-5-5", ...overrides };
  const repo = new Repository(openDatabase(config.dbPath));
  repo.seedPromptVersions(SEED_PROMPTS);
  const app = createApp({ config, repo, ...extra });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    repo,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    json: async <T,>(path: string, init?: RequestInit) => {
      const res = await fetch(url + path, {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}
