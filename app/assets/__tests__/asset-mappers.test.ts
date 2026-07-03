import { describe, expect, it } from "vitest";
import { contentAssetToProduct } from "../../../lib/asset-mappers";
import type { ContentAsset } from "../../../lib/api";

function asset(overrides: Partial<ContentAsset>): ContentAsset {
  return {
    id: 1,
    project_id: null,
    parent_asset_id: null,
    library_kind: "copy",
    asset_kind: "video",
    content_type: "video_script",
    title: "小户型家具宣传视频",
    status: "draft",
    source_type: "generated",
    generation_state: "director_script_draft",
    source_filename: null,
    source_content_type: null,
    original_ref: null,
    markdown_ref: null,
    content_hash: null,
    body: "# 小户型家具宣传视频\n\n## 分镜脚本\n\n### 第1段：开场\n\n展示客厅空间。",
    metadata: {
      capability: "video_script",
      capability_label: "编导文稿",
      video_workflow_stage: "director_script_draft"
    },
    source_mapping: [],
    linked_asset_ids: [],
    linked_event_ids: [],
    archived: false,
    error_message: null,
    created_at: "2026-07-03T00:00:00Z",
    updated_at: "2026-07-03T00:00:00Z",
    versions: [],
    ...overrides
  };
}

describe("asset product mapper", () => {
  it("does not create timeline preview for copy-mode video script drafts", () => {
    const product = contentAssetToProduct(asset({}));

    expect(product.mode).toBe("copy");
    expect(product.timeline).toEqual([]);
  });

  it("shows director drafts as video copy drafts before video project creation", () => {
    const product = contentAssetToProduct(asset({}));

    expect(product.mode).toBe("copy");
    expect(product.status).toBe("文案 · 编导草稿 · 有来源");
    expect(product.phase).toBe("视频文案草稿");
    expect(product.preview?.eyebrow).toBe("视频文案草稿");
    expect(product.preview?.subtitle).toContain("确认后生成视频工程");
  });

  it("treats video projects as the final conversation output without mp4 render prompts", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video_render",
      content_type: "video_render",
      metadata: {
        capability: "video_render",
        capability_label: "视频工程",
        video_workflow_stage: "video_project_ready",
        video_project: {
          version: "multimix_video_project_v1",
          ratio: "9:16",
          duration_seconds: 30,
          tracks: []
        }
      }
    }));

    const visibleText = [
      product.status,
      product.summary,
      product.preview?.subtitle ?? "",
      ...product.sections.flatMap((section) => [section.label, section.title, section.detail, section.status])
    ].join("\n");

    expect(product.mode).toBe("video");
    expect(visibleText).not.toContain("成片");
    expect(visibleText).not.toContain("MP4");
    expect(visibleText).not.toContain("导出");
    expect(product.actions).toContain("调整分镜");
  });
});
