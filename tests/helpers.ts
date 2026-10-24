import type { Server } from "node:http";
import type { RunEvent } from "../shared/types";
import { SEED_PROMPTS } from "../fixtures/prompts";
import { createApp } from "../server/app";
import type { ServerConfig } from "../server/config";
import { openDatabase } from "../server/db/database";
import { Repository } from "../server/db/repository";
import { MockProvider } from "../server/provider/mock";
import { RunManager } from "../server/runner/runManager";

export interface TestServer {
  url: string;
  repo: Repository;
  manager: RunManager;
  close: () => Promise<void>;
  json: <T>(path: string, init?: RequestInit) => Promise<{ status: number; body: T }>;
}

export async function startTestServer(
  overrides: Partial<ServerConfig> = {},
  extra: { manager?: (repo: Repository) => RunManager } = {},
): Promise<TestServer> {
  const config: ServerConfig = { port: 0, dbPath: ":memory:", apiKey: null, defaultModel: "claude-opus-5-5", googleApiKey: null, googleModel: "gemini-3.5-flash", ...overrides };
  const repo = new Repository(openDatabase(config.dbPath));
  repo.seedPromptVersions(SEED_PROMPTS);
  const manager =
    extra.manager?.(repo) ?? new RunManager({ repo, providers: { mock: new MockProvider({ chunkDelayMs: 1 }) } });
  const app = createApp({ config, repo, manager });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    repo,
    manager,
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

/** Minimal SSE reader over fetch, for driving /api/runs/:id/stream in tests. */
export async function* readSse(url: string, signal?: AbortSignal): AsyncGenerator<RunEvent> {
  const res = await fetch(url, { signal, headers: { accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) yield JSON.parse(data) as RunEvent;
    }
  }
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
