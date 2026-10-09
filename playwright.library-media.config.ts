import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "library-media-presentation.spec.ts", workers: 1,
  timeout: 60_000, reporter: "list", outputDir: ".tmp/library-media-browser",
  use: { baseURL: "http://127.0.0.1:3229", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3229",
    url: "http://127.0.0.1:3229", reuseExistingServer: false, timeout: 120_000,
    env: { NEXT_DEV_DIST_DIR: ".tmp/library-media-next", NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:18229",
      NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local" },
  },
});
