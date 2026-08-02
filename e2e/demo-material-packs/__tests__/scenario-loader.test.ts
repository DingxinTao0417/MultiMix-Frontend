import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadScenario } from "../scenario-loader";

const packsRoot = path.resolve(process.cwd(), "..", "demo_material_packs");

describe("loadScenario", () => {
  it("loads scenario 04 with its material-gap thresholds", () => {
    const scenario = loadScenario(packsRoot, "04");

    expect(scenario.slug).toBe("material_gap_and_dialog_boundary");
    expect(scenario.primaryImages).toHaveLength(1);
    expect(scenario.distractorImages).toHaveLength(2);
    expect(scenario.thresholds.noAssetHitMinimum).toBe(4);
    expect(scenario.prompts.initial.length).toBeGreaterThan(20);
  });

  it("loads synthetic provenance and compliance rules for scenario 01", () => {
    const scenario = loadScenario(packsRoot, "01");

    expect(scenario.syntheticAssets.some((asset) => asset.testRole === "positive_saved_asset")).toBe(true);
    expect(scenario.forbiddenPhrases).toContain("0 甲醛");
  });
});
