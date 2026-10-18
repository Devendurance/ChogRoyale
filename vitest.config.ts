import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.resolve(rootDir, "./src") } },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 60000,
    // DB suites clean owned fixtures in beforeAll/afterAll with real Neon
    // round trips (1-10s each from this machine). A 10s hook timeout aborted
    // cleanup and left rows that broke the next run, so hooks get the same
    // bound as tests.
    hookTimeout: 60000,
  },
});
