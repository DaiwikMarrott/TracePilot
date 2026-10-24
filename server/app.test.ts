import { afterEach, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../tests/helpers";

describe("GET /api/health", () => {
  let server: TestServer;
  afterEach(() => server?.close());

  it("reports live availability without exposing the key", async () => {
    server = await startTestServer({ apiKey: "sk-secret" });
    const res = await fetch(`${server.url}/api/health`);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, liveAvailable: true });
    expect(text).not.toContain("sk-secret");
  });
});
