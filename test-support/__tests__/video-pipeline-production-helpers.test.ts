import { describe, expect, it } from "vitest";

import {
  PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION,
  normalizePresenterRoundTripTrack,
  selectClosestDurationCandidate,
  selectProductionGeneratedRecomposeTarget,
} from "../video-pipeline-production-helpers";

describe("normalizePresenterRoundTripTrack", () => {
  const subtitleTrack = {
    id: "track-text",
    type: "text",
    elements: [
      {
        id: "subtitle-1",
        content: "我们的项目是一个生产力AI应用。",
        displayText: "我们的项目是一个生产力AI应用。",
        startTime: 3.2,
        duration: 3.92,
      },
    ],
  };

  it("accepts editor-authored line wrapping when semantic subtitle text is unchanged", () => {
    const reopened = {
      ...subtitleTrack,
      elements: [
        {
          ...subtitleTrack.elements[0],
          content: "我们的项目是一\n个生产力AI应用。",
        },
      ],
    };

    expect(normalizePresenterRoundTripTrack(reopened)).toEqual(
      normalizePresenterRoundTripTrack(subtitleTrack),
    );
  });

  it("does not hide changed words, timing drift, or missing subtitle elements", () => {
    const changedWord = {
      ...subtitleTrack,
      elements: [
        {
          ...subtitleTrack.elements[0],
          content: "我们的项目是一个娱乐AI应用。",
        },
      ],
    };
    const changedTiming = {
      ...subtitleTrack,
      elements: [
        {
          ...subtitleTrack.elements[0],
          startTime: 4.2,
        },
      ],
    };
    const missingElement = { ...subtitleTrack, elements: [] };

    expect(normalizePresenterRoundTripTrack(changedWord)).not.toEqual(
      normalizePresenterRoundTripTrack(subtitleTrack),
    );
    expect(normalizePresenterRoundTripTrack(changedTiming)).not.toEqual(
      normalizePresenterRoundTripTrack(subtitleTrack),
    );
    expect(normalizePresenterRoundTripTrack(missingElement)).not.toEqual(
      normalizePresenterRoundTripTrack(subtitleTrack),
    );
  });

  it("keeps non-subtitle tracks byte-for-byte strict", () => {
    const mediaTrack = {
      id: "track-presenter-media",
      type: "video",
      elements: [{ id: "event-1", startTime: 2, duration: 1 }],
    };

    expect(normalizePresenterRoundTripTrack(mediaTrack)).toEqual(mediaTrack);
  });
});

describe("selectClosestDurationCandidate", () => {
  it("selects the grounded top candidate closest to the requested duration", () => {
    expect(selectClosestDurationCandidate([
      { id: "long", target_seconds: 91.48 },
      { id: "fit", target_seconds: 31.13 },
    ], ["long", "fit"], 30)?.id).toBe("fit");
  });

  it("keeps top-candidate rank for equal duration distance and rejects invalid rows", () => {
    expect(selectClosestDurationCandidate([
      { id: "outside", target_seconds: 30 },
      { id: "first", target_seconds: 29 },
      { id: "second", target_seconds: 31 },
      { id: "invalid", target_seconds: 0 },
    ], ["first", "second", "invalid"], 30)?.id).toBe("first");
    expect(selectClosestDurationCandidate([], [], 30)).toBeUndefined();
  });
});

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
