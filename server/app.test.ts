import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("GET /api/health", () => {
  it("reports live availability without exposing the key", async () => {
    const app = createApp({ port: 0, dbPath: ":memory:", apiKey: "sk-secret", defaultModel: "claude-opus-5-5" });
    const server = app.listen(0);
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://localhost:${port}/api/health`);
    const text = await res.text();
    server.close();
    expect(JSON.parse(text)).toMatchObject({ ok: true, liveAvailable: true });
    expect(text).not.toContain("sk-secret");
  });
});
