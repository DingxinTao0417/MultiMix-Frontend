import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Playwright specs are *.spec.ts. The demo-material-packs/__tests__/*.test.ts
  // files are vitest suites (run via `test:demo-units`); without this guard
  // Playwright's default testMatch also globs *.test.ts and crashes trying to
  // require('vitest') in its CommonJS collector.
  testMatch: "**/*.spec.ts",
  timeout: process.env.DEMO_MODE ? 120_000 : 30_000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/display-coverage/playwright",
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3219",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
