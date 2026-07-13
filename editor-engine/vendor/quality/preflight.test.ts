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
