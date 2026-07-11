import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/demo-material-packs/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
