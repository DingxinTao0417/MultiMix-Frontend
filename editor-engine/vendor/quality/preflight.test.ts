import { describe, expect, it } from "vitest";

import type { BackendProject } from "../buildProject";
import { inspectEditorProject } from "./preflight";

const baseProject: BackendProject = {
  metadata: {
    title: "测试工程",
    duration: 10,
    duration_contract: {
      target_seconds: 10,
      tolerance_ratio: 0.1,
      min_seconds: 9,
      max_seconds: 11,
    },
  },
  settings: { fps: 30, width: 1080, height: 1920 },
  media: [{ id: "m1", type: "video", file_path: "local://video-orchestration/m1.mp4", name: "m1" }],
  tracks: [],
};

describe("inspectEditorProject", () => {
  it("blocks unknown edit atoms instead of exporting an unchanged picture", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [{
        id: "track-video",
        type: "video",
        name: "素材",
        elements: [{
          id: "v1",
          type: "video",
          mediaId: "m1",
          startTime: 0,
          duration: 10,
          segmentId: "scene-1",
          editDecision: { layout: "hologram", motion: "static", transition: "cut" },
        }],
      }],
    });

    expect(report.blockers.map((item) => item.code)).toContain("edit_decision_atom_unsupported");
  });

  it("keeps compiled information layers outside the subtitle safe region", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "素材",
          elements: [{ id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 10, segmentId: "scene-1" }],
        },
        {
          id: "track-edit-overlays",
          type: "text",
          name: "信息层",
          elements: [{
            id: "value-1",
            type: "text",
            content: "已确认价值",
            startTime: 0,
            duration: 5,
            segmentId: "scene-1",
            textRole: "edit_overlay",
            editOverlayKind: "value",
            safeRegion: { x: 0.58, y: 0.46, width: 0.34, height: 0.16 },
          }],
        },
        {
          id: "track-text",
          type: "text",
          name: "字幕",
          elements: [{
            id: "subtitle-1",
            type: "text",
            content: "完整字幕",
            startTime: 0,
            duration: 5,
            segmentId: "scene-1",
            textRole: "subtitle",
            safeRegion: { x: 0.08, y: 0.74, width: 0.84, height: 0.22 },
          }],
        },
      ],
    });

    expect(report.blockers.map((item) => item.code)).not.toContain("edit_overlay_subtitle_collision");
  });
  it("reports duration outside the contract as a warning without blocking export", () => {
    const report = inspectEditorProject({
      ...baseProject,
      metadata: { ...baseProject.metadata, duration: 6 },
      tracks: [{
        id: "track-video",
        type: "video",
        name: "素材",
        elements: [{ id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 6, segmentId: "scene-1" }],
      }],
    });

    expect(report.blockers.map((item) => item.code)).not.toContain("duration_out_of_range");
    expect(report.warnings.map((item) => item.code)).toContain("duration_out_of_range");
    expect(report.status).toBe("pass");
  });

  it("blocks a main-track gap longer than one frame", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [{
        id: "track-video",
        type: "video",
        name: "素材",
        elements: [
          { id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 4.9, segmentId: "scene-1" },
          { id: "v2", type: "video", mediaId: "m1", startTime: 5, duration: 5, segmentId: "scene-2" },
        ],
      }],
    });

    expect(report.blockers.map((item) => item.code)).toContain("main_track_gap");
  });

  it("blocks captions over two lines and MG/subtitle safe-region collisions", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "素材",
          elements: [{ id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 10, segmentId: "scene-1" }],
        },
        {
          id: "track-text",
          type: "text",
          name: "字幕",
          elements: [{
            id: "t1",
            type: "text",
            content: "第一行\n第二行\n第三行",
            startTime: 0,
            duration: 5,
            segmentId: "scene-1",
            safeRegion: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
          }],
        },
        {
          id: "track-overlay",
          type: "video",
          name: "动效",
          overlay: true,
          elements: [{
            id: "o1",
            type: "video",
            mediaId: "m1",
            startTime: 0,
            duration: 3,
            segmentId: "scene-1",
            safeRegion: { x: 0.2, y: 0.75, width: 0.6, height: 0.15 },
          }],
        },
      ],
    });

    expect(report.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining(["subtitle_too_many_lines", "overlay_subtitle_collision"]),
    );
  });

  it("does not treat a presenter media takeover as an MG/subtitle collision", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "口播主画面",
          elements: [{ id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 10, segmentId: "scene-1" }],
        },
        {
          id: "track-text",
          type: "text",
          name: "字幕",
          elements: [{
            id: "subtitle-1",
            type: "text",
            content: "口播字幕",
            startTime: 0,
            duration: 10,
            segmentId: "scene-1",
            textRole: "subtitle",
            safeRegion: { x: 0.08, y: 0.76, width: 0.84, height: 0.18 },
          }],
        },
        {
          id: "track-presenter-media",
          type: "video",
          name: "口播素材增强",
          overlay: true,
          logicalLayer: "media_enhancement",
          elements: [{
            id: "takeover-1",
            type: "video",
            mediaId: "m1",
            startTime: 2,
            duration: 4,
            segmentId: "scene-1",
            eventType: "media_takeover",
            fullFrame: true,
            safeRegion: { x: 0, y: 0, width: 1, height: 1 },
          }],
        },
      ],
    });

    expect(report.blockers.map((item) => item.code)).not.toContain("overlay_subtitle_collision");
  });

  it("checks subtitle roles without treating presentation support as captions", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "素材",
          elements: [{ id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 10, segmentId: "scene-1" }],
        },
        {
          id: "track-support",
          type: "text",
          name: "截图补充信息",
          elements: [{
            id: "support-1",
            type: "text",
            textRole: "presentation_support",
            content: "已审核截图\n完整工作流\n来源可追溯",
            startTime: 0,
            duration: 5,
            segmentId: "scene-support",
            safeRegion: { x: 0.1, y: 0.1, width: 0.4, height: 0.5 },
          }],
        },
        {
          id: "track-text",
          type: "text",
          name: "字幕",
          elements: [{
            id: "subtitle-1",
            type: "text",
            textRole: "subtitle",
            content: "第一行\n第二行\n第三行",
            startTime: 5,
            duration: 5,
            segmentId: "scene-subtitle",
            safeRegion: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
          }],
        },
        {
          id: "track-overlay",
          type: "video",
          name: "动效",
          overlay: true,
          elements: [{
            id: "overlay-1",
            type: "video",
            mediaId: "m1",
            startTime: 0,
            duration: 3,
            segmentId: "scene-support",
            safeRegion: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
          }],
        },
      ],
    });

    expect(
      report.blockers
        .filter((item) => item.code === "subtitle_too_many_lines")
        .map((item) => item.segment_id),
    ).toEqual(["scene-subtitle"]);
    expect(report.blockers.map((item) => item.code)).not.toContain("overlay_subtitle_collision");
  });

  it("passes when overlay and subtitle use the backend's disjoint safe regions", () => {
    // Mirrors app/services/video_studio/safe_area.py: body band 0.12–0.72,
    // subtitle band 0.72–0.98. Correctly-stamped elements must not collide.
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "素材",
          elements: [{ id: "v1", type: "video", mediaId: "m1", startTime: 0, duration: 10, segmentId: "scene-1" }],
        },
        {
          id: "track-text",
          type: "text",
          name: "字幕",
          elements: [{
            id: "t1",
            type: "text",
            content: "第一行\n第二行",
            startTime: 0,
            duration: 5,
            segmentId: "scene-1",
            safeRegion: { x: 0.08, y: 0.74, width: 0.84, height: 0.22 },
          }],
        },
        {
          id: "track-overlay",
          type: "video",
          name: "动效",
          overlay: true,
          elements: [{
            id: "o1",
            type: "video",
            mediaId: "m1",
            startTime: 0,
            duration: 3,
            segmentId: "scene-1",
            safeRegion: { x: 0.06, y: 0.12, width: 0.88, height: 0.56 },
          }],
        },
      ],
    });

    expect(report.blockers.map((item) => item.code)).not.toContain("overlay_subtitle_collision");
  });

  it("keeps backend landscape body and subtitle regions disjoint", () => {
    const report = inspectEditorProject({
      ...baseProject,
      metadata: { ...baseProject.metadata, width: 1920, height: 1080 },
      tracks: [
        {
          id: "track-text",
          type: "text",
          name: "字幕",
          elements: [{
            id: "t-landscape",
            type: "text",
            content: "横屏字幕",
            startTime: 0,
            duration: 5,
            segmentId: "scene-1",
            safeRegion: { x: 0.08, y: 0.76, width: 0.84, height: 0.18 },
          }],
        },
        {
          id: "track-overlay",
          type: "video",
          name: "动效",
          overlay: true,
          elements: [{
            id: "o-landscape",
            type: "video",
            mediaId: "m1",
            startTime: 0,
            duration: 3,
            segmentId: "scene-1",
            safeRegion: { x: 0.06, y: 0.1, width: 0.88, height: 0.6 },
          }],
        },
      ],
    });

    expect(report.blockers.map((item) => item.code)).not.toContain("overlay_subtitle_collision");
  });

  it("blocks a missing media reference on the current timeline", () => {
    const report = inspectEditorProject({
      ...baseProject,
      tracks: [{
        id: "track-video",
        type: "video",
        name: "素材",
        elements: [{ id: "v1", type: "video", mediaId: "missing", startTime: 0, duration: 10, segmentId: "scene-1" }],
      }],
    });

    expect(report.blockers.map((item) => item.code)).toContain("missing_media_reference");
  });
});
