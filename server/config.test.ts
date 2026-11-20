import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("listens on loopback only unless HOST is set", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
    expect(loadConfig({ HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
    expect(loadConfig({ HOST: "" }).host).toBe("127.0.0.1");
  });

  it("treats blank keys as missing", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "  ", GOOGLE_API_KEY: "g-key" });
    expect(config.apiKey).toBeNull();
    expect(config.googleApiKey).toBe("g-key");
  });
});
