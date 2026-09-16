import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadScenario } from "../scenario-loader";

const documentNames = [
  "raw_text_materials.md",
  "client_chat_log.md",
  "data_notes.md",
  "data_constraints.md",
  "mg_overlay_candidates.md",
];

let packsRoot = "";

function writeScenarioFixture(folder: string, primaryImages: number, distractorImages: number) {
  const directory = path.join(packsRoot, folder);
  const images = path.join(directory, "images");
  const distractors = path.join(directory, "distractor_assets");
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(distractors, { recursive: true });
  documentNames.forEach((name) => fs.writeFileSync(path.join(directory, name), `fixture for ${name}`));
  fs.writeFileSync(path.join(directory, "demo_prompts.md"), [
    "## 首轮生成提示词",
    "请根据素材生成一条信息完整、证据可追溯的短视频编导稿。",
    "## 多轮改写提示词",
    "- 保持事实来源不变",
    "## 结构性改写提示词",
    "调整叙事顺序，同时保留原始事实与素材引用。",
    "## 对话边界提示词",
    "- 不编造素材中不存在的事实",
  ].join("\n"));
  Array.from({ length: primaryImages }, (_, index) => {
    fs.writeFileSync(path.join(images, `primary-${index}.png`), "image");
  });
  Array.from({ length: distractorImages }, (_, index) => {
    fs.writeFileSync(path.join(distractors, `distractor-${index}.png`), "image");
  });
}

beforeAll(() => {
  packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-scenario-loader-"));
  writeScenarioFixture("01_local_service_home_renovation", 1, 0);
  writeScenarioFixture("04_material_gap_and_dialog_boundary", 1, 2);
  fs.writeFileSync(path.join(packsRoot, "material_source_manifest.json"), JSON.stringify({
    assets: [{
      path: "01_local_service_home_renovation/images/primary-0.png",
      scenario: "01_local_service_home_renovation",
      test_role: "positive_saved_asset",
      expected_usage: "primary-track",
    }],
  }));
});

afterAll(() => {
  fs.rmSync(packsRoot, { force: true, recursive: true });
});

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
