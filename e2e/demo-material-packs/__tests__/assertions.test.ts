import { describe, expect, it } from "vitest";

import { scoreInitialPlan } from "../assertions";
import type { ScenarioDefinition } from "../types";

const scenario = {
  id: "01",
  targetDurationSeconds: 25,
  forbiddenPhrases: ["0 甲醛"],
  thresholds: { effectiveSceneMinimum: 1, matchedMinimum: 1 },
} as ScenarioDefinition;

describe("scoreInitialPlan", () => {
  it("fails R7 when a distractor is selected", () => {
    const checks = scoreInitialPlan(scenario, {
      imageIds: [11],
      distractorIds: [99],
      markdown: "合规文案",
      scenes: [{ narration: "厨房测量", asset_reference: { status: "matched", chosen_asset_id: 99, match_confidence: 0.91 }, mg_decision: { mode: "overlay", needed: false, status: "not_needed" } }],
    });

    expect(checks.find((check) => check.code === "R7")).toMatchObject({ status: "failed", severity: "P0" });
  });

  it("passes R4 when stock fallback retains no_asset_hit", () => {
    const checks = scoreInitialPlan(scenario, {
      imageIds: [11],
      distractorIds: [],
      markdown: "合规文案",
      scenes: [{ narration: "补充画面", asset_reference: { status: "no_asset_hit", chosen_asset_id: 501, match_confidence: 0 }, material_candidates: [{ source_type: "stock", asset_id: 501 }], mg_decision: { mode: "overlay", needed: true, status: "planned", chosen_template: "data_card", reason: "演示数据" } }],
    });

    expect(checks.find((check) => check.code === "R4")?.status).toBe("passed");
  });

  it("fails compliance and synthetic truthfulness as P0", () => {
    const checks = scoreInitialPlan(scenario, {
      imageIds: [11], distractorIds: [], scenes: [],
      markdown: "真实客户案例证明 0 甲醛",
      syntheticEvidencePhrases: ["真实客户案例"],
    });

    expect(checks.find((check) => check.code === "C1")?.status).toBe("failed");
    expect(checks.find((check) => check.code === "C4")).toMatchObject({ status: "failed", severity: "P0" });
  });
});
