import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MIN_NODE_VERSION, nodeVersionError } from "./nodeVersion";

describe("nodeVersionError", () => {
  it("accepts the minimum and anything newer", () => {
    expect(nodeVersionError("22.12.0")).toBeNull();
    expect(nodeVersionError("v22.13.1")).toBeNull();
    expect(nodeVersionError("24.0.0")).toBeNull();
  });

  it("explains how to fix an older version", () => {
    const message = nodeVersionError("22.11.0");
    expect(message).toContain("needs Node.js 22.12.0 or newer, but this is 22.11.0");
    expect(message).toContain("nvm use");
    expect(nodeVersionError("20.18.0")).not.toBeNull();
  });

  it("matches the engines field in package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines: { node: string } };
    expect(pkg.engines.node).toBe(`>=${MIN_NODE_VERSION.replace(/\.0$/, "")}`);
  });
});
