import { describe, expect, it } from "vitest";
import { contentAssetToProduct, videoJobStageLabel, videoJobStepIndex } from "../../../lib/asset-mappers";
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
    expect(product.status).toBe("有来源");
    expect(product.phase).toBe("编导稿");
    expect(product.preview?.eyebrow).toBe("编导稿");
    expect(product.preview?.subtitle).toContain("确认后");
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

  it("marks orchestration-pending video assets as generating", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_render",
      status: "processing",
      metadata: {
        capability: "video_render",
        capability_label: "视频编排",
        orchestration_pending: true,
        latest_job_public_id: "video-job-abc"
      }
    }));

    expect(product.status).toBe("视频生成中 · 后台任务");
    expect(product.preview?.subtitle).toContain("后台生成");
  });

  it("maps video project segments with asset references, fallback and MG decisions", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video_render",
      content_type: "video_render",
      metadata: {
        capability: "video_render",
        video_project: {
          version: "multimix_video_project_v1",
          ratio: "9:16",
          duration_seconds: 30,
          segments: [
            {
              id: "seg-1",
              title: "痛点开场",
              startTime: 0,
              duration: 5,
              narration: "装修最烧钱的坑，十个有九个在定制柜上",
              asset_reference: {
                status: "matched",
                chosen_asset_id: 12,
                source_snapshot: { title: "客厅落地窗效果" }
              },
              mg_decision: { needed: false }
            },
            {
              id: "seg-2",
              title: "案例展示",
              startTime: 5,
              duration: 9,
              narration: "这是上周刚交付的全屋定制",
              asset_reference: {
                status: "matched",
                chosen_asset_id: 13,
                source_snapshot: { title: "门窗安装完工全景" }
              },
              mg_decision: { needed: true, visible_summary: { label: "面积利用率 +35%" } }
            },
            {
              id: "seg-3",
              title: "报价引导",
              startTime: 14,
              duration: 6,
              narration: "评论区扣 1，送你一份避坑报价单",
              asset_reference: { status: "no_asset_hit" }
            }
          ]
        }
      }
    }));

    expect(product.segments).toHaveLength(3);
    expect(product.segments?.[0]).toMatchObject({
      index: 1,
      title: "痛点开场",
      startSeconds: 0,
      endSeconds: 5,
      assetTitle: "客厅落地窗效果",
      isFallback: false
    });
    expect(product.segments?.[1]?.mgLabel).toBe("面积利用率 +35%");
    expect(product.segments?.[2]?.isFallback).toBe(true);
    expect(product.sourceSummary?.headline).toBe("基于 2 个已保存素材 + 1 段兜底素材生成");
    expect(product.sourceSummary?.note).toContain("素材命中率 2/3");
    expect(product.sourceSummary?.refs.map((ref) => ref.title)).toEqual(["客厅落地窗效果", "门窗安装完工全景"]);
  });

  it("builds a source summary from source_mapping for copy products", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "copy",
      content_type: "social_post",
      metadata: { capability: "social_post" },
      source_mapping: [
        { title: "市场规则变化素材包", asset_id: 7, state: "ready", reference_count: 3 },
        { title: "LinkedIn买家洞察", asset_id: 9, state: "processing" }
      ]
    }));

    expect(product.segments).toBeUndefined();
    expect(product.sourceSummary?.headline).toBe("基于 2 个素材生成");
    expect(product.sourceSummary?.refs).toMatchObject([
      { title: "市场规则变化素材包", statusLabel: "已解析", referenceCount: 3 },
      { title: "LinkedIn买家洞察", statusLabel: "处理中" }
    ]);
  });

  it("omits segments and source summary when the metadata carries none", () => {
    const product = contentAssetToProduct(asset({}));

    expect(product.segments).toBeUndefined();
    expect(product.sourceSummary).toBeUndefined();
  });

  it("marks failed orchestration assets as retryable with the error detail", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_render",
      status: "failed",
      error_message: "TTS provider timeout",
      metadata: {
        capability: "video_render",
        capability_label: "视频编排",
        latest_job_public_id: "video-job-abc"
      }
    }));

    expect(product.status).toBe("生成失败 · 可重试");
    expect(product.preview?.subtitle).toContain("TTS provider timeout");
  });
});

describe("video job stage helpers", () => {
  it("maps backend render stages to Chinese labels", () => {
    expect(videoJobStageLabel("queued")).toBe("排队等待中");
    expect(videoJobStageLabel("script")).toBe("正在生成脚本");
    expect(videoJobStageLabel("segment")).toBe("正在匹配素材与合成配音");
    expect(videoJobStageLabel("unknown_stage")).toBe("正在生成");
  });

  it("maps stages onto ordered progress steps", () => {
    expect(videoJobStepIndex("queued")).toBe(0);
    expect(videoJobStepIndex("script")).toBe(0);
    expect(videoJobStepIndex("segment")).toBe(1);
    expect(videoJobStepIndex("done")).toBe(3);
  });
});
