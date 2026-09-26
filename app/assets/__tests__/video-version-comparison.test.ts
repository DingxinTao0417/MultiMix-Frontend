import { describe, expect, it } from "vitest";

import { compareVideoVersionSegments, videoSegmentChangeDetails, videoSegmentChangeSummary } from "../lib/video-version-comparison";
import type { AssetProductSegment } from "../lib/asset-workspace-types";

function segment(overrides: Partial<AssetProductSegment> = {}): AssetProductSegment {
  return {
    id: "segment-1",
    index: 1,
    title: "痛点开场",
    startSeconds: 0,
    endSeconds: 5,
    line: "原口播",
    subLine: "原字幕",
    assetTitle: "客厅近景",
    isFallback: false,
    mgLabel: "面积利用率",
    mgStatus: "completed",
    ...overrides,
  };
}

describe("video version segment comparison", () => {
  it("returns only structurally affected segments with stable change kinds", () => {
    const previous = [segment()];
    const current = [segment({
      endSeconds: 3,
      line: "新口播",
      assetTitle: "完工全景",
      mgLabel: "收纳提升",
    })];

    expect(compareVideoVersionSegments(previous, current)).toEqual([
      expect.objectContaining({
        id: "segment-1",
        title: "痛点开场",
        previousStartSeconds: 0,
        currentStartSeconds: 0,
        previousDurationSeconds: 5,
        currentDurationSeconds: 3,
        changeKinds: ["timing", "visual", "copy", "mg"],
      }),
    ]);
  });

  it("does not return unchanged segments", () => {
    const unchanged = segment();
    expect(compareVideoVersionSegments([unchanged], [{ ...unchanged }])).toEqual([]);
  });

  it("marks added and removed segments without text-similarity guessing", () => {
    const previous = [
      segment({ id: "segment-1", index: 1 }),
      segment({ id: "segment-removed", index: 2, title: "旧收束" }),
    ];
    const current = [
      segment({ id: "segment-1", index: 1 }),
      segment({ id: "segment-added", index: 2, title: "新收束" }),
    ];

    const result = compareVideoVersionSegments(previous, current);
    expect(result).toEqual([
      expect.objectContaining({
        id: "segment-added",
        title: "新收束",
        changeKinds: ["structure"],
        previousSegment: null,
      }),
      expect.objectContaining({
        id: "segment-removed",
        title: "旧收束",
        changeKinds: ["structure"],
        currentSegment: null,
      }),
    ]);
  });

  it("falls back to the same index only when a stable id is unavailable", () => {
    const previous = [segment({ id: "", index: 1, line: "原口播" })];
    const current = [segment({ id: "", index: 1, line: "新口播" })];

    expect(compareVideoVersionSegments(previous, current)).toEqual([
      expect.objectContaining({
        id: "segment-index-1",
        changeKinds: ["copy"],
      }),
    ]);
  });

  it("marks a stable scene moved to another position as a structural change", () => {
    const previous = [segment({ id: "segment-1", index: 1 })];
    const current = [segment({ id: "segment-1", index: 2 })];

    expect(compareVideoVersionSegments(previous, current)).toEqual([
      expect.objectContaining({ id: "segment-1", changeKinds: ["structure"] }),
    ]);
  });

  it("states verifiable before-and-after values instead of only change categories", () => {
    const [change] = compareVideoVersionSegments(
      [segment()],
      [segment({ endSeconds: 3, line: "新口播", assetTitle: "完工全景" })],
    );

    expect(videoSegmentChangeSummary(change)).toContain("5→3 秒");
    expect(videoSegmentChangeSummary(change)).toContain("口播已调整");
    expect(videoSegmentChangeDetails(change)).toEqual(expect.arrayContaining([
      { label: "时长", before: "5 秒", after: "3 秒" },
      { label: "口播", before: "原口播", after: "新口播" },
      { label: "素材", before: "客厅近景", after: "完工全景" },
    ]));
  });

  it("does not invent a material identity when only its thumbnail changes", () => {
    const [change] = compareVideoVersionSegments(
      [segment()],
      [segment({ assetThumbnailUrl: "updated-thumbnail.png" })],
    );

    expect(videoSegmentChangeSummary(change)).toBe("画面已调整");
    expect(videoSegmentChangeDetails(change)).toEqual([]);
  });
});
