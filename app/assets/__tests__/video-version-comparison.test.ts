import { describe, expect, it } from "vitest";

import { compareVideoVersionOverview, compareVideoVersionSegments, videoSegmentChangeDetails, videoSegmentChangeSummary } from "../lib/video-version-comparison";
import type { AssetProductSegment } from "../lib/asset-workspace-types";
import { contentAssetToProduct } from "../../../lib/asset-mappers";
import type { ContentAsset } from "../../../lib/api";

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
      { label: "素材名称", before: "客厅近景", after: "完工全景" },
    ]));
  });

  it("shows an explicitly cleared value but does not infer a value for an unknown historical field", () => {
    const [clearedLine] = compareVideoVersionSegments(
      [segment({ line: "原口播" })],
      [segment({ line: "" })],
    );
    expect(videoSegmentChangeDetails(clearedLine)).toContainEqual({
      label: "口播", before: "原口播", after: "已清除",
    });

    const unknownLine = compareVideoVersionSegments(
      [segment({ line: "原口播" })],
      [segment({ line: undefined })],
    );
    expect(unknownLine).toEqual([]);
  });

  it("does not invent copy, timing, visual, or motion differences from one-sided missing evidence", () => {
    expect(compareVideoVersionSegments(
      [segment({ primaryVisualIdentity: "saved_asset:asset:12" })],
      [segment({ line: undefined, startSeconds: undefined, endSeconds: undefined,
        primaryVisualIdentity: undefined, mgLabel: undefined })],
    )).toEqual([]);
  });

  it("does not treat a mapper-derived fallback false as proof of a visual change", () => {
    const mapped = (scene: Record<string, unknown>) => contentAssetToProduct({
      id: 1, project_id: null, parent_asset_id: null, asset_kind: "video",
      content_type: "video_project", title: "视频", status: "ready",
      source_filename: null, source_content_type: null, original_ref: null,
      markdown_ref: null, content_hash: null, body: "",
      metadata: { video_project: { segments: [scene] } },
      linked_asset_ids: [], linked_event_ids: [], archived: false, error_message: null,
      created_at: "2026-09-27T00:00:00Z", updated_at: "2026-09-27T00:00:00Z",
      versions: [],
    } as ContentAsset).segments;
    const previous = mapped({ id: "scene-1", title: "开场", primary_visual: {
      source_type: "public_asset", status: "persisted", artifact_ref: "local://public.mp4",
    } });
    const current = mapped({ id: "scene-1", title: "开场" });

    expect(previous?.[0]?.isFallback).toBe(true);
    expect(current?.[0]?.isFallback).toBe(false);
    expect(current?.[0]?.primaryVisualSourceType).toBeUndefined();
    expect(compareVideoVersionSegments(previous, current)).toEqual([]);

    expect(compareVideoVersionSegments(
      [segment({ primaryVisualSourceType: "public_asset", primaryVisualIdentity: "public_asset:ref:before" })],
      [segment({ primaryVisualSourceType: "saved_asset", primaryVisualIdentity: "saved_asset:asset:12" })],
    )).toEqual([expect.objectContaining({ changeKinds: ["visual"] })]);
  });

  it("does not report an affected scene when only its thumbnail URL changes", () => {
    expect(compareVideoVersionSegments(
      [segment()],
      [segment({ assetThumbnailUrl: "updated-thumbnail.png" })],
    )).toEqual([]);

    expect(compareVideoVersionSegments(
      [segment({ primaryVisualIdentity: "saved_asset:asset:12", primaryVisualPersisted: true, primaryVisualSourceType: "saved_asset" })],
      [segment({ primaryVisualIdentity: "saved_asset:asset:13", primaryVisualPersisted: true, primaryVisualSourceType: "saved_asset" })],
    )).toHaveLength(1);
  });

  it("does not call a renamed asset a replacement without a changed authoritative reference", () => {
    const [renamed] = compareVideoVersionSegments(
      [segment({ assetReferenceId: 12, assetTitle: "拍摄素材" })],
      [segment({ assetReferenceId: 12, assetTitle: "重新命名的素材" })],
    );
    expect(videoSegmentChangeSummary(renamed)).toBe("素材信息已调整");
    expect(videoSegmentChangeDetails(renamed)).toContainEqual({
      label: "素材名称", before: "拍摄素材", after: "重新命名的素材",
    });

    const [replaced] = compareVideoVersionSegments(
      [segment({ assetReferenceId: 12, primaryVisualIdentity: "saved_asset:asset:12", primaryVisualPersisted: true, primaryVisualSourceType: "saved_asset" })],
      [segment({ assetReferenceId: 13, primaryVisualIdentity: "saved_asset:asset:13", primaryVisualPersisted: true, primaryVisualSourceType: "saved_asset" })],
    );
    expect(videoSegmentChangeSummary(replaced)).toBe("素材已更换");

    expect(compareVideoVersionSegments(
      [segment({ assetReferenceId: 12 })],
      [segment({ assetReferenceId: 13 })],
    )).toEqual([]);
  });

  it("shows only verifiable whole-video changes", () => {
    const base = {
      id: "video", mode: "video" as const, title: "视频", status: "完成", summary: "",
      ratio: "9:16", duration: "30 秒", phase: "完成", sections: [], timeline: [], actions: [],
    };
    const previous = { ...base, metadata: { video_project: {
      duration_seconds: 30,
      metadata: { bgm_choice: { enabled: true, catalog_id: "calm" } },
      media: [{ file_path: "bgm://calm", name: "轻快" }],
    } } };
    const current = { ...base, ratio: "16:9", metadata: { video_project: {
      duration_seconds: 32,
      metadata: { bgm_choice: { enabled: false } },
    } } };
    expect(compareVideoVersionOverview(previous, current)).toEqual([
      { label: "画幅", before: "9:16", after: "16:9" },
      { label: "全片时长", before: "30 秒", after: "32 秒" },
      { label: "背景音乐", before: "轻快", after: "已关闭" },
    ]);
    expect(compareVideoVersionOverview(previous, { ...previous })).toEqual([]);
    expect(compareVideoVersionOverview({ ...base }, { ...base, ratio: "16:9" })).toEqual([
      { label: "画幅", before: "9:16", after: "16:9" },
    ]);
  });

  it("ignores placeholder ratios and never exposes a raw BGM catalog ID", () => {
    const base = {
      id: "video", mode: "video" as const, title: "视频", status: "完成", summary: "",
      ratio: "按指令", duration: "30 秒", phase: "完成", sections: [], timeline: [], actions: [],
    };
    const previous = { ...base, metadata: { video_project: {
      metadata: { bgm_choice: { enabled: true, catalog_id: "bgm_7f91" } },
    } } };
    const current = { ...base, ratio: "9:16", metadata: { video_project: {
      metadata: { bgm_choice: { enabled: false } },
    } } };
    expect(compareVideoVersionOverview(previous, current)).toEqual([
      { label: "背景音乐", before: "旧配乐（名称未记录）", after: "已关闭" },
    ]);
  });
});
