import { describe, expect, it } from "vitest";

import {
  PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION,
  selectProductionGeneratedRecomposeTarget,
} from "../video-pipeline-production-helpers";

describe("selectProductionGeneratedRecomposeTarget", () => {
  it("selects a generated MG scene instead of another generated visual family", () => {
    const scenes = [
      {
        id: "seg-screen",
        primary_visual: { source_type: "generated_scene" },
        primary_visual_strategy: { mode: "screen_scene" },
      },
      {
        id: "seg-public",
        primary_visual: { source_type: "public_asset" },
        primary_visual_strategy: { mode: "public_broll" },
      },
      {
        id: "seg-mg",
        primary_visual: { source_type: "generated_scene" },
        primary_visual_strategy: { mode: "mg_scene" },
      },
    ];

    expect(selectProductionGeneratedRecomposeTarget(scenes)?.id).toBe("seg-mg");
  });

  it("falls back to another generated primary when MG is a rendered overlay", () => {
    const scenes = [
      {
        id: "seg-overlay",
        primary_visual: { source_type: "public_asset" },
        primary_visual_strategy: { mode: "public_broll" },
        mg_decision: { status: "rendered" },
      },
      {
        id: "seg-generated",
        primary_visual: { source_type: "generated_scene" },
        primary_visual_strategy: { mode: "evidence_card" },
      },
    ];

    expect(selectProductionGeneratedRecomposeTarget(scenes)?.id).toBe(
      "seg-generated",
    );
  });

  it("returns undefined instead of silently falling back to the first scene", () => {
    const scenes = [
      {
        id: "seg-first",
        primary_visual: { source_type: "public_asset" },
        primary_visual_strategy: { mode: "public_broll" },
      },
    ];

    expect(selectProductionGeneratedRecomposeTarget(scenes)).toBeUndefined();
  });
});

describe("PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION", () => {
  it("preserves the selected generated mode without assuming every MG is a primary", () => {
    expect(PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION).toContain(
      "保留当前主画面模式",
    );
    expect(PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION).toContain(
      "不要切换主画面类型",
    );
    expect(PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION).toContain(
      "如果本镜包含 MG 动画",
    );
    expect(PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION).not.toContain(
      "产品界面更突出",
    );
  });
});
