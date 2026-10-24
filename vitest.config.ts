import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two projects: backend and SDK tests run in Node (where MSW's node
// interceptor sees the SDK's fetch calls); component tests run in jsdom.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["server/**/*.test.ts", "tests/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          include: ["client/src/**/*.test.tsx"],
          setupFiles: ["client/src/test/setup.ts"],
        },
      },
    ],
  },
});
