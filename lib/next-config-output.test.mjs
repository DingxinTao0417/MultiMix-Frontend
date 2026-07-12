import { readFile } from "node:fs/promises";

import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER
} from "next/constants.js";
import { describe, expect, it } from "vitest";

import createNextConfig from "../next.config.mjs";

describe("Next.js output directories", () => {
  it("isolates development output from production build output", () => {
    const developmentConfig = createNextConfig(PHASE_DEVELOPMENT_SERVER);
    const productionBuildConfig = createNextConfig(PHASE_PRODUCTION_BUILD);
    const productionServerConfig = createNextConfig(PHASE_PRODUCTION_SERVER);

    expect(developmentConfig.distDir).toBe(".next");
    expect(productionBuildConfig.distDir).toBe(".next-build");
    expect(productionServerConfig.distDir).toBe(".next-build");
    expect(developmentConfig.distDir).not.toBe(productionBuildConfig.distDir);
  });

  it("keeps generated output ignored and both type directories available", async () => {
    const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
    const tsconfig = JSON.parse(
      await readFile(new URL("../tsconfig.json", import.meta.url), "utf8")
    );

    expect(gitignore).toMatch(/^\.next-build\/$/m);
    expect(tsconfig.include).toContain(".next/types/**/*.ts");
    expect(tsconfig.include).toContain(".next-build/types/**/*.ts");
  });
});
