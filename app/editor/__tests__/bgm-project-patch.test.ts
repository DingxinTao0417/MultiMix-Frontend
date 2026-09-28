import { describe, expect, it } from "vitest";
import { mergeBgmProjectPatch } from "../bgm-project-patch";
import { buildProject, segmentIdByElementId, filePathByMediaId } from "@/editor-engine/vendor/buildProject";
import type { BackendProject } from "@/editor-engine/vendor/buildProject";

const latest = {
  metadata: { title: "Latest", duration: 9, local: "keep", bgm_choice: { enabled: true } },
  settings: { fps: 30, width: 1920, height: 1080 },
  media: [{ id: "image", type: "image", file_path: "local://image.png", name: "Image" },
    { id: "media-bgm-old", type: "audio", file_path: "bgm://old", name: "Old" }],
  tracks: [{ id: "main", type: "video", name: "Main", elements: [
    { id: "split-new", type: "image", mediaId: "image", segmentId: "s1", startTime: 0, duration: 9 },
  ] }, { id: "track-bgm", type: "audio", name: "Old", elements: [] }],
} as BackendProject;

describe("BGM-only response patch", () => {
  it("keeps the latest split, settings and metadata when applying a stale BGM response", () => {
    const old = { ...latest, metadata: { title: "Old", duration: 6, bgm_choice: { enabled: false } },
      settings: { ...latest.settings, width: 720 }, tracks: [], media: [] };
    const result = mergeBgmProjectPatch(latest, old);
    expect(result.tracks).toEqual([latest.tracks[0]]);
    expect(result.media).toEqual([latest.media[0]]);
    expect(result.settings).toEqual(latest.settings);
    expect(result.metadata).toEqual({ ...latest.metadata, bgm_choice: { enabled: false } });
    expect(latest.tracks).toHaveLength(2);
  });

  it("building a scoped audio patch does not clear the live scene mappings", () => {
    buildProject(latest);
    const bgmOnly = { ...latest, tracks: [], media: [] };
    buildProject(bgmOnly, { preserveMappings: true });
    expect(segmentIdByElementId["split-new"]).toBe("s1");
    expect(filePathByMediaId.image).toBe("local://image.png");
  });
});
