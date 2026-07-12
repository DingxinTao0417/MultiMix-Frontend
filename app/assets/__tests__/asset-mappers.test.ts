import { describe, expect, it } from "vitest";
import { agentTimelineStepsFromBackend, conversationFromPersisted, contentAssetToProduct, videoJobStageLabel, videoJobStepIndex, videoJobTimelineSteps } from "../../../lib/asset-mappers";
import type { ContentAsset } from "../../../lib/api";
import type { AssetProduct } from "../lib/asset-workspace-types";

// Minimal fallback product for conversationFromPersisted (kept off the wire).
const newConversationProduct = {
  id: "empty-product",
  mode: "video",
  title: "等待生成的产物",
  status: "未生成",
  summary: "",
  ratio: "待确认",
  duration: "待确认",
  phase: "等待指令",
  sections: [],
  timeline: [],
  actions: []
} as AssetProduct;

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
  it("maps director script drafts to the continuous document surface", () => {
    const product = contentAssetToProduct(asset({}));

    expect(product.mode).toBe("copy");
    expect(product.markdownBody).toContain("展示客厅空间");
    expect(product.videoProjectReady).toBe(false);
  });

  it("keeps director draft metadata without presenting a video preview", () => {
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
      status: "ready",
      metadata: {
        capability: "video_render",
        capability_label: "视频工程",
        video_workflow_stage: "video_project_ready",
        orchestration_pending: false,
        video_project: {
          version: "multimix_video_project_v1",
          ratio: "9:16",
          duration_seconds: 30,
          tracks: [],
          media: []
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

  it("does not expose a false-ready project without the editor timeline shape", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video_render",
      content_type: "video_render",
      status: "ready",
      metadata: {
        capability: "video_render",
        video_workflow_stage: "video_project_ready",
        orchestration_pending: false,
        video_project: { title: "placeholder only" },
      },
    }));

    expect(product.status).toBe("工程异常 · 待恢复");
    expect(product.preview?.subtitle).not.toContain("视频工程已生成");
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

  it("normalizes product ratios without horizontal or vertical wording", () => {
    const portrait = contentAssetToProduct(asset({
      metadata: {
        capability: "video_script",
        capability_label: "编导文稿",
        intent: { ratio: "9:16竖屏" }
      }
    }));
    const landscape = contentAssetToProduct(asset({
      metadata: {
        capability: "video_script",
        capability_label: "编导文稿",
        intent: { ratio: "16：9横屏" }
      }
    }));

    expect(portrait.ratio).toBe("9:16");
    expect(landscape.ratio).toBe("16:9");
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

  it("projects real video-project track timing onto semantic scenes", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video_render",
      content_type: "video_render",
      status: "ready",
      metadata: {
        capability: "video_render",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_segments: [
          {
            id: "scene-1",
            title: "痛点开场",
            narration: "装修最烧钱的坑",
            duration_seconds: 4,
            asset_reference: {
              status: "matched",
              source_snapshot: { title: "客厅素材", preview_url: "https://cdn.example/scene-1.jpg" }
            },
            mg_decision: { needed: true, chosen_template: "title_card", status: "rendered" }
          },
          {
            id: "scene-2",
            title: "案例展示",
            narration: "这是刚交付的案例",
            duration_seconds: 5,
            asset_reference: { status: "no_asset_hit" },
            mg_decision: { needed: true, chosen_template: "data_card", status: "failed" }
          }
        ],
        video_project: {
          metadata: { duration: 12.75 },
          media: [],
          tracks: [
            {
              id: "track-text",
              type: "text",
              elements: [
                { id: "tel-0", segmentId: "scene-1", startTime: 0, duration: 5.25 },
                { id: "tel-1", segmentId: "scene-2", startTime: 5.25, duration: 7.5 }
              ]
            }
          ],
          script: { title: "测试工程", content: "装修最烧钱的坑\n这是刚交付的案例" },
          orchestration: { segment_count: 2 }
        }
      }
    }));

    expect(product.videoProjectReady).toBe(true);
    expect(product.segments).toMatchObject([
      {
        id: "scene-1",
        startSeconds: 0,
        endSeconds: 5.25,
        assetThumbnailUrl: "https://cdn.example/scene-1.jpg",
        mgLabel: "title_card",
        mgStatus: "rendered"
      },
      {
        id: "scene-2",
        startSeconds: 5.25,
        endSeconds: 12.75,
        mgLabel: "data_card",
        mgStatus: "failed"
      }
    ]);
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

describe("agent timeline steps", () => {
  it("marks the active stage as running and earlier stages as done", () => {
    const steps = videoJobTimelineSteps("segment", "running");
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "run", "wait"]);
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.label)).toEqual([
      "创建视频工程任务",
      "读取已确认方案并准备分镜",
      "匹配分镜素材并准备配音、字幕",
      "组装可编辑视频工程",
    ]);
  });

  it("marks all steps done once the job completes", () => {
    const steps = videoJobTimelineSteps("done", "completed");
    expect(steps.every((step) => step.status === "done")).toBe(true);
  });

  it("marks the current stage failed when the job fails", () => {
    const steps = videoJobTimelineSteps("segment", "failed");
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "fail", "wait"]);
  });

  it("maps backend steps[] with real elapsed labels", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "understand", label: "理解素材并写脚本", status: "done", elapsedSeconds: 8 },
      { key: "plan", label: "匹配素材并合成配音", status: "run", elapsedSeconds: null },
      { key: "generate", label: "组装分镜与时间线", status: "wait", elapsedSeconds: null }
    ]);
    expect(steps.map((step) => step.status)).toEqual(["done", "run", "wait"]);
    expect(steps[0].elapsedLabel).toBe("8秒");
    expect(steps[1].elapsedLabel).toBeUndefined();
  });

  it("preserves backend elapsed seconds for execution summaries", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "create_job", label: "创建视频工程任务", status: "done", elapsedSeconds: null },
      { key: "prepare_scenes", label: "读取已确认方案并准备分镜", status: "done", elapsedSeconds: 1.25 },
    ]);
    expect(steps[1].elapsedSeconds).toBe(1.25);
    expect(steps[1].elapsedLabel).toBe("1.3秒");
  });

  it("preserves a backend retry job id only when one exists", () => {
    const steps = agentTimelineStepsFromBackend([
      {
        key: "prepare_media",
        label: "匹配分镜素材并准备配音、字幕",
        status: "fail",
        elapsedSeconds: 4,
        retryJobId: "video-job-1",
      },
      { key: "build_project", label: "组装可编辑视频工程", status: "wait" },
    ]);
    expect(steps[0].retryJobId).toBe("video-job-1");
    expect(steps[1].retryJobId).toBeUndefined();
  });

  it("formats minute-scale elapsed and skips malformed backend steps", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "understand", label: "理解素材并写脚本", status: "done", elapsedSeconds: 72 },
      { key: "", label: "no key", status: "done", elapsedSeconds: 3 }
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].elapsedLabel).toBe("1分12秒");
  });

  it("returns empty for missing backend steps so the caller falls back", () => {
    expect(agentTimelineStepsFromBackend(undefined)).toEqual([]);
    expect(agentTimelineStepsFromBackend(null)).toEqual([]);
    expect(agentTimelineStepsFromBackend([])).toEqual([]);
  });
});

describe("message plan mapping", () => {
  it("classifies persisted confirmation control events for presentation", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-control-events",
        title: "确认视频工程",
        status: "ready",
        metadata: {},
        created_at: "2026-07-08T00:00:00Z",
        updated_at: "2026-07-08T00:00:00Z",
        products: [],
        messages: [
          {
            id: 1,
            role: "user",
            text: "确认，生成视频工程",
            asset_id: null,
            created_at: "2026-07-08T00:00:00Z",
            metadata: {
              confirmation_idempotency_key: "confirm-1",
              video_workflow_stage: "director_script_confirmed",
            },
          },
          {
            id: 2,
            role: "assistant",
            text: "视频工程已进入生成队列",
            asset_id: null,
            created_at: "2026-07-08T00:00:01Z",
            metadata: {
              confirmation_idempotency_key: "confirm-1",
              product_id: 451,
              video_workflow_stage: "video_project_queued",
            },
          },
          {
            id: 3,
            role: "assistant",
            text: "普通回复",
            asset_id: null,
            created_at: "2026-07-08T00:00:02Z",
            metadata: {},
          },
        ],
      },
      newConversationProduct,
    );

    expect(conversation.messages?.map((message) => message.presentation)).toEqual([
      "hidden_confirmation",
      "execution_anchor",
      "standard",
    ]);
    expect(conversation.messages?.[1].assetId).toBe(451);
  });

  it("parses a structured plan from assistant message metadata", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-1",
        title: "案例",
        status: "ready",
        metadata: {},
        created_at: "2026-07-08T00:00:00Z",
        updated_at: "2026-07-08T00:00:00Z",
        products: [],
        messages: [
          {
            id: 1,
            role: "assistant",
            text: "给你拆了一个方案",
            asset_id: null,
            created_at: "2026-07-08T00:00:00Z",
            metadata: {
              plan: {
                title: "文案生成方案",
                status: "pending",
                subtitle: "都可以改",
                fields: [
                  { key: "platform", label: "平台", value: "小红书" },
                  { key: "hero", label: "主图", value: "案例图 #2", refs: [{ title: "完工全景" }] }
                ],
                confirm_utterance: "确认，开始生成"
              }
            }
          }
        ]
      },
      newConversationProduct
    );
    const plan = conversation.messages?.[0]?.plan;
    expect(plan?.title).toBe("文案生成方案");
    expect(plan?.status).toBe("pending");
    expect(plan?.fields).toHaveLength(2);
    expect(plan?.fields[1]?.refs?.[0]?.title).toBe("完工全景");
    expect(plan?.confirmUtterance).toBe("确认，开始生成");
  });

  it("ignores a plan payload with no usable fields", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-2",
        title: "空",
        status: "ready",
        metadata: {},
        created_at: "2026-07-08T00:00:00Z",
        updated_at: "2026-07-08T00:00:00Z",
        products: [],
        messages: [
          {
            id: 1,
            role: "assistant",
            text: "没有方案",
            asset_id: null,
            created_at: "2026-07-08T00:00:00Z",
            metadata: { plan: { title: "空方案", fields: [] } }
          }
        ]
      },
      newConversationProduct
    );
    expect(conversation.messages?.[0]?.plan).toBeUndefined();
  });
});
