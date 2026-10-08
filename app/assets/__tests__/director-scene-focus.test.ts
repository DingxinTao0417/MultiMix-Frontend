import { describe, expect, it } from "vitest";
import { resolveSelectedSceneFocus } from "../components/assets-workspace-client";
import type { AssetProduct } from "../lib/asset-workspace-types";

const draft = (): AssetProduct => ({
  id: "asset-17", backendAssetId: 17, contentType: "video_script",
  mode: "video", title: "编导稿", status: "完成", summary: "", ratio: "9:16",
  duration: "30 秒", phase: "编导脚本", sections: [], timeline: [], actions: [],
  versions: [{ id: "101", label: "第一版", savedAt: "刚刚", status: "完成" }],
  metadata: { video_plan: { scenes: [{ id: "scene-1" }, { id: "scene-2" }] } },
});

describe("director scene composer focus", () => {
  it("binds the current draft scene by stable id and version", () => {
    expect(resolveSelectedSceneFocus(draft(), 17, { sceneId: "scene-2", versionId: 101 }))
      .toEqual({ sceneId: "scene-2", versionId: 101 });
  });

  it("rejects stale versions and removed scenes before sending", () => {
    expect(() => resolveSelectedSceneFocus(draft(), 17, { sceneId: "scene-2", versionId: 100 }))
      .toThrow("分镜已更新");
    expect(() => resolveSelectedSceneFocus(draft(), 17, { sceneId: "scene-3", versionId: 101 }))
      .toThrow("分镜已更新");
  });

  it("does not carry scene focus into a different selected product", () => {
    expect(resolveSelectedSceneFocus(draft(), 99, { sceneId: "scene-2", versionId: 101 }))
      .toBeUndefined();
  });
});
