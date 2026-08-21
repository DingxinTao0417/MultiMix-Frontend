import { describe, expect, it } from "vitest";
import { agentTimelineStepsFromBackend, conversationFromPersisted, contentAssetToProduct, videoJobStageLabel, videoJobStepIndex } from "../../../lib/asset-mappers";
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
  it("uses only generating, completed, and failed for video products", () => {
    const baseProject = { timeline: { tracks: [], media: [] } };
    const generating = contentAssetToProduct(asset({
      id: 201,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "generating",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: baseProject,
        video_plan: { scenes: [{ id: "scene-1", mg_decision: { needed: true, status: "planned" } }] },
      },
    }));
    expect(generating.productStatus).toBe("generating");
    expect(generating.status).toBe("生成中");
    expect(generating.videoProjectReady).toBe(true);

    const completed = contentAssetToProduct(asset({
      id: 202,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "completed",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: baseProject,
        video_plan: { scenes: [{ id: "scene-1", mg_decision: { needed: true, status: "rendered" } }] },
      },
    }));
    expect(completed.productStatus).toBe("completed");
    expect(completed.status).toBe("完成");
    expect(completed.videoProjectReady).toBe(true);

    const failed = contentAssetToProduct(asset({
      id: 203,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "failed",
      failure_reason: "动效服务超时",
      failure_action: "retry",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: baseProject,
        video_plan: { scenes: [{ id: "scene-1", mg_decision: { needed: true, status: "failed", last_error: "动效服务超时" } }] },
      },
    }));
    expect(failed.productStatus).toBe("failed");
    expect(failed.status).toBe("失败");
    expect(failed.failureReason).toBe("动效服务超时");
  });

  it("maps the recorded failed scene id without parsing the error sentence", () => {
    const failed = contentAssetToProduct(asset({
      id: 204,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      generation_state: "video_project_ready",
      product_status: "failed",
      failure_action: "replace_scene_asset",
      failure_scene_id: "seg-4",
      error_message: "素材失效",
      metadata: {
        video_workflow_stage: "video_project_ready",
        failure_action: "replace_scene_asset",
        pipeline_attempt: {
          failure: {
            code: "original_material_unavailable",
            scene_id: "seg-4",
          },
        },
      },
    }));

    expect(failed.failureAction).toBe("replace_scene_asset");
    expect(failed.failureSceneId).toBe("seg-4");
  });

  it("maps a long-form candidate set to the dedicated product contract", () => {
    const product = contentAssetToProduct(asset({
      id: 92,
      asset_kind: "analysis",
      content_type: "long_form_candidate_set",
      status: "ready",
      generation_state: "long_form_candidates_ready",
      metadata: {
        source_asset_id: 91,
        chapter_count: 8,
        candidate_count: 12,
        top_candidate_ids: ["cand_01", "cand_02"],
        top_candidates: [
          { id: "cand_01", title: "别只看收入", target_seconds: 45 },
          { id: "cand_02", title: "利润和回款", target_seconds: 60 },
        ],
      },
    }));

    expect(product.contentType).toBe("long_form_candidate_set");
    expect(product.phase).toBe("拆条候选");
    expect(product.status).toBe("2 条优先候选");
    expect(product.actions).toEqual(["再给我更多候选", "只看指定主题", "调整时长或比例"]);
  });

  it("prefers a ready video project over public video-script task state", () => {
    const readyProject = asset({
      id: 2,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: { timeline: { tracks: [], media: [] } },
      },
    });
    const conversation = conversationFromPersisted({
      id: "asset-conversation-ready-wins",
      title: "厨房动线与收纳规划",
      status: "active",
      metadata: {},
      agent_tasks: {
        active: {
          goal: "video_script",
          status: "waiting_user",
          asset_id: 2,
          version_id: null,
          scene_id: "scene-2",
        },
        paused: [],
      },
      active_agent_action: {
        id: "action-replace-scene-2",
        status: "succeeded",
        requires_confirmation: false,
        confirmation_id: null,
        asset_id: 2,
        version_id: null,
        message: "视频修改已完成。",
        retryable: false,
      },
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-02T00:01:00Z",
      products: [asset({ id: 1 }), readyProject],
      messages: [{
        id: 1,
        role: "assistant",
        text: "编导稿已生成。",
        asset_id: 1,
        metadata: {
          suggestions: ["确认，生成视频工程", "调整分镜"],
          agent_action_run_id: "action-replace-scene-2",
          agent_action: {
            id: "action-replace-scene-2",
            status: "succeeded",
            requires_confirmation: false,
            confirmation_id: null,
            asset_id: 2,
            version_id: null,
            message: "视频修改已完成。",
            retryable: false,
          },
        },
        created_at: "2026-08-02T00:00:00Z",
      }],
    }, newConversationProduct);

    expect(conversation.product.backendAssetId).toBe(2);
    expect(conversation.agentTasks).toBeUndefined();
    expect(conversation.activeAgentAction).toBeUndefined();
    expect(conversation.messages?.[0]?.suggestions).toEqual(["确认，生成视频工程", "调整分镜"]);
    expect(conversation.messages?.[0]?.agentAction).toMatchObject({
      id: "action-replace-scene-2",
      status: "succeeded",
    });
  });

  it("keeps a server-confirmed video-project plan compact beside a ready video", () => {
    const readyProject = asset({
      id: 12,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: { timeline: { tracks: [], media: [] } },
      },
    });
    const conversation = conversationFromPersisted({
      id: "asset-conversation-ready-confirmed-plan",
      title: "家装服务宣传讲解",
      status: "active",
      metadata: {},
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:01:00Z",
      products: [asset({ id: 11 }), readyProject],
      messages: [{
        id: 1,
        role: "assistant",
        text: "已生成编导稿。",
        asset_id: 11,
        metadata: {
          plan: {
            kind: "video_project_confirmation",
            title: "视频方案",
            status: "confirmed",
            fields: [{ key: "duration", label: "时长", value: "约 30 秒 · 6 个分镜" }],
            confirm_label: "确认，生成视频工程",
            confirm_utterance: "确认，生成视频工程",
          },
          suggestions: ["确认，生成视频工程", "调整分镜"],
        },
        created_at: "2026-08-20T00:00:00Z",
      }],
    }, newConversationProduct);

    expect(conversation.messages?.[0]?.suggestions).toEqual(["确认，生成视频工程", "调整分镜"]);
    expect(conversation.messages?.[0]?.plan).toMatchObject({
      kind: "video_project_confirmation",
      status: "confirmed",
    });
  });

  it("keeps a new-video parameter confirmation visible beside an existing ready project", () => {
    const readyProject = asset({
      id: 120,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: { timeline: { tracks: [], media: [] } },
      },
    });
    const conversation = conversationFromPersisted({
      id: "asset-conversation-ready-new-video-parameters",
      title: "家装服务宣传讲解",
      status: "active",
      metadata: {},
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:01:00Z",
      products: [readyProject],
      messages: [{
        id: 1,
        role: "user",
        text: "再做一条新视频",
        asset_id: null,
        metadata: {},
        created_at: "2026-08-20T00:00:00Z",
      }, {
        id: 2,
        role: "assistant",
        text: "请确认参数。",
        asset_id: null,
        metadata: {
          plan: {
            kind: "video_parameter_confirmation",
            title: "确认视频参数",
            status: "pending",
            fields: [{ key: "duration", label: "目标时长", value: "30 秒" }],
          },
        },
        created_at: "2026-08-20T00:00:01Z",
      }],
    }, newConversationProduct);

    expect(conversation.messages?.map((message) => message.text)).toEqual([
      "再做一条新视频",
      "请确认参数。",
    ]);
    expect(conversation.messages?.[1]?.plan).toMatchObject({
      kind: "video_parameter_confirmation",
      status: "pending",
    });
  });

  it("hides a parameter confirmation that the server marks as superseded", () => {
    const conversation = conversationFromPersisted({
      id: "asset-conversation-server-superseded-parameters",
      title: "家装服务宣传讲解",
      status: "active",
      metadata: {},
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:01:00Z",
      products: [],
      messages: [{
        id: 1,
        role: "assistant",
        text: "请确认视频参数。",
        asset_id: null,
        metadata: {
          plan: {
            kind: "video_parameter_confirmation",
            title: "确认视频参数",
            status: "superseded",
            fields: [{ key: "duration", label: "目标时长", value: "30 秒" }],
          },
        },
        created_at: "2026-08-20T00:00:01Z",
      }],
    }, newConversationProduct);

    expect(conversation.messages).toEqual([]);
  });

  it("hides only the parameter card that the server marks as superseded", () => {
    const readyProject = asset({
      id: 121,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: { timeline: { tracks: [], media: [] } },
      },
    });
    const conversation = conversationFromPersisted({
      id: "asset-conversation-ready-stale-parameters",
      title: "家装服务宣传讲解",
      status: "active",
      metadata: {},
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:01:00Z",
      products: [readyProject],
      messages: [{
        id: 1,
        role: "assistant",
        text: "视频工程已生成，可立即编辑。",
        asset_id: 121,
        metadata: {},
        created_at: "2026-08-20T00:00:00Z",
      }, {
        id: 2,
        role: "user",
        text: "确认生成视频工程",
        asset_id: null,
        metadata: {},
        created_at: "2026-08-20T00:00:10Z",
      }, {
        id: 3,
        role: "assistant",
        text: "那我先做一条 30 秒横屏的确认工程视频。",
        asset_id: null,
        metadata: {},
        created_at: "2026-08-20T00:00:11Z",
      }, {
        id: 4,
        role: "user",
        text: "确认",
        asset_id: null,
        metadata: {},
        created_at: "2026-08-20T00:00:12Z",
      }, {
        id: 5,
        role: "assistant",
        text: "请确认视频参数。",
        asset_id: null,
        metadata: {
          plan: {
            kind: "video_parameter_confirmation",
            title: "确认视频参数",
            status: "superseded",
            fields: [{ key: "duration", label: "目标时长", value: "30 秒" }],
          },
        },
        created_at: "2026-08-20T00:00:13Z",
      }],
    }, newConversationProduct);

    expect(conversation.messages?.map((message) => message.text)).toEqual([
      "视频工程已生成，可立即编辑。",
      "确认生成视频工程",
      "那我先做一条 30 秒横屏的确认工程视频。",
      "确认",
    ]);
  });

  it("derives a ready video project's duration from its persisted timeline", () => {
    const product = contentAssetToProduct(asset({
      id: 122,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "completed",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: {
          orchestration: { layout: "landscape" },
          timeline: {
            tracks: [{
              type: "video",
              elements: [
                { startTime: 0, duration: 18 },
                { startTime: 18, duration: 27 },
              ],
            }],
            media: [],
          },
        },
      },
    }));

    expect(product.status).toBe("完成");
    expect(product.ratio).toBe("16:9");
    expect(product.duration).toBe("45秒");
  });

  it("does not let a malformed non-script artifact replace the current director script", () => {
    const director = asset({ id: 488, generation_state: "draft", metadata: { capability: "video_script", video_workflow_stage: "draft" } });
    const malformed = asset({
      id: 489,
      parent_asset_id: 488,
      content_type: "mg_overlay",
      metadata: { capability: "video_script", video_workflow_stage: "director_script_draft" },
    });

    const conversation = conversationFromPersisted({
      id: "asset-conversation-malformed-director",
      title: "商业计划书讲解",
      status: "active",
      metadata: {},
      created_at: "2026-07-12T00:00:00Z",
      updated_at: "2026-07-12T00:01:00Z",
      products: [director, malformed],
      messages: [],
    }, newConversationProduct);

    expect(conversation.product.backendAssetId).toBe(488);
    expect(conversation.product.mode).toBe("copy");
  });

  it("keeps legacy video-script drafts on the continuous document surface", () => {
    const product = contentAssetToProduct(asset({
      generation_state: "draft",
      metadata: {
        capability: "video_script",
        capability_label: "编导稿",
        video_workflow_stage: "draft",
      },
    }));

    expect(product.mode).toBe("copy");
    expect(product.markdownBody).toContain("展示客厅空间");
    expect(product.videoProjectReady).toBe(false);
  });

  it("maps director script drafts to the continuous document surface", () => {
    const product = contentAssetToProduct(asset({}));

    expect(product.mode).toBe("copy");
    expect(product.markdownBody).toContain("展示客厅空间");
    expect(product.videoProjectReady).toBe(false);
  });

  it("keeps short narration drafts on the editable text surface", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "short_video_narration",
      metadata: { capability: "short_video_narration" },
    }));

    expect(product.mode).toBe("copy");
    expect(product.contentType).toBe("short_video_narration");
    expect(product.markdownBody).toContain("展示客厅空间");
  });

  it("labels keyword copy templates as ungrounded templates instead of sourced content", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "copy",
      content_type: "social_post",
      metadata: {
        capability: "social_post",
        template_mode: true,
        grounding_status: "keyword_template",
        template_fields_grounded: false,
      },
    }));

    expect(product.status).toBe("关键词模板");
    expect(product.sections.find((section) => section.label === "来源")).toMatchObject({
      title: "待补充资料",
      status: "keyword-template",
    });
    expect(product.preview?.subtitle).toContain("不代表真实业务事实");
  });

  it("keeps director draft metadata without presenting a video preview", () => {
    const product = contentAssetToProduct(asset({}));

    expect(product.mode).toBe("copy");
    expect(product.status).toBe("完成");
    expect(product.phase).toBe("编导脚本");
    expect(product.preview?.eyebrow).toBe("编导脚本");
    expect(product.preview?.subtitle).toContain("确认后");
  });

  it("treats video projects as the final conversation output without mp4 render prompts", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
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

  it("presents video projects as video projects instead of inherited director drafts", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "completed",
      metadata: {
        artifact_category: "编导稿",
        capability: "video_project",
        video_workflow_stage: "video_project_ready",
        orchestration_pending: false,
        video_project: {
          version: "multimix_video_project_v1",
          ratio: "16:9",
          duration_seconds: 30,
          tracks: [],
          media: [],
        },
      },
    }));

    expect(product.phase).toBe("视频");
    expect(product.status).toBe("完成");
  });

  it("does not expose a false-ready project without the editor timeline shape", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "failed",
      failure_reason: "视频内容不完整，无法正常播放或编辑。",
      failure_action: "retry",
      metadata: {
        capability: "video_project",
        video_workflow_stage: "video_project_ready",
        orchestration_pending: false,
        video_project: { title: "placeholder only" },
      },
    }));

    expect(product.status).toBe("失败");
    expect(product.preview?.subtitle).toContain("视频内容不完整");
  });

  it("marks an orphaned video project as a project that needs recovery", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "draft",
      product_status: "failed",
      failure_reason: "视频内容不完整，无法正常播放或编辑。",
      failure_action: "retry",
      metadata: {
        capability: "video_project",
        video_workflow_stage: "draft",
      },
    }));

    expect(product.status).toBe("失败");
    expect(product.preview?.subtitle).toContain("视频内容不完整");
    expect(product.videoProjectReady).toBe(false);
  });

  it("marks orchestration-pending video assets as generating", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "processing",
      product_status: "generating",
      metadata: {
        capability: "video_project",
        capability_label: "视频编排",
        orchestration_pending: true,
        latest_job_public_id: "video-job-abc"
      }
    }));

    expect(product.status).toBe("生成中");
    expect(product.preview?.subtitle).toContain("后台生成");
  });

  it("prefers persisted failure over stale orchestration-pending metadata", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "failed",
      product_status: "failed",
      failure_reason: "Job exceeded its timeout without completing and was marked failed.",
      failure_action: "retry",
      error_message: "Job exceeded its timeout without completing and was marked failed.",
      metadata: {
        capability: "video_project",
        capability_label: "视频编排",
        orchestration_pending: true,
        latest_job_public_id: "video-job-stale",
      },
    }));

    expect(product.status).toBe("失败");
    expect(product.preview?.subtitle).toContain("生成失败");
    expect(product.preview?.subtitle).not.toContain("后台生成");
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

  it("restores a missing product ratio from deterministic video project geometry", () => {
    const fromLayout = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
        video_workflow_stage: "video_project_ready",
        orchestration_pending: false,
        video_project: {
          tracks: [],
          media: [],
          orchestration: { layout: "landscape" },
        },
      },
    }));
    const fromCanvas = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
        video_workflow_stage: "video_project_ready",
        orchestration_pending: false,
        video_project: {
          tracks: [],
          media: [],
          settings: { width: 1080, height: 1920 },
        },
      },
    }));

    expect(fromLayout.ratio).toBe("16:9");
    expect(fromCanvas.ratio).toBe("9:16");
  });

  it("maps video project segments with asset references, fallback and MG decisions", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      metadata: {
        capability: "video_project",
        video_plan: {
          scenes: [
            { id: "seg-1", voice: { name: "male_steady" } },
            { id: "seg-2", voice: { name: "female_bright" } },
            { id: "seg-3", voice: { name: "female_warm" } },
          ],
        },
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
              asset_reference: { status: "no_asset_hit" },
              material_resolution: { fill_status: "public_candidate" }
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
    expect(product.segments?.[2]?.materialFillStatus).toBe("public_candidate");
    expect(product.segments?.[0]?.voiceName).toBe("male_steady");
    expect(product.segments?.[0]?.visualStatusLabel).toBeUndefined();
    expect(product.segments?.[0]?.primaryVisualSourceType).toBeUndefined();
    expect(product.sourceSummary?.headline).toBe("基于 2 个已保存素材生成 · 1 个公共素材候选");
    expect(product.sourceSummary?.note).toContain("已保存素材命中 2/3");
    expect(product.sourceSummary?.note).not.toContain("兜底素材");
    expect(product.sourceSummary?.refs.map((ref) => ref.title)).toEqual(["客厅落地窗效果", "门窗安装完工全景"]);
  });

  it("reports a persisted public primary visual as material used by the video", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
        video_project: {
          segments: [{
            id: "seg-public",
            title: "公共场景",
            asset_reference: { status: "no_asset_hit" },
            material_resolution: { fill_status: "public_candidate", final_source_type: "public_asset" },
            primary_visual: {
              status: "persisted",
              source_type: "public_asset",
              artifact_ref: "local://public-scene.mp4",
            },
          }],
        },
      },
    }));

    expect(product.segments?.[0]).toMatchObject({
      isFallback: true,
      materialFillStatus: "public_candidate",
      primaryVisualSourceType: "public_asset",
      primaryVisualPersisted: true,
    });
    expect(product.sourceSummary?.headline).toBe("基于 1 个公共素材生成");
  });

  it("does not report unfilled generated scenes as public material", () => {
    const product = contentAssetToProduct(asset({
      metadata: {
        capability: "video_script",
        video_workflow_stage: "director_script_draft",
        video_plan: {
          scenes: [
            {
              id: "seg-saved",
              title: "产品界面",
              asset_reference: {
                status: "matched",
                source_snapshot: { title: "PDF 产品界面" },
              },
              material_resolution: { fill_status: "saved_hit" },
            },
            {
              id: "seg-generated",
              title: "流程动画",
              asset_reference: { status: "no_asset_hit" },
              material_resolution: { fill_status: "unfilled" },
              primary_visual_strategy: { mode: "mg_scene" },
            },
          ],
        },
      },
    }));

    expect(product.segments?.[1]?.isFallback).toBe(false);
    expect(product.sourceSummary?.headline).toBe("基于 1 个已保存素材生成");
  });

  it("maps a persisted generated primary visual as available scene media", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
        video_segments: [
          {
            id: "scene-2",
            title: "上传流程",
            narration: "上传资料后自动生成视频。",
            asset_reference: { status: "no_asset_hit" },
            primary_visual: {
              status: "persisted",
              source_type: "generated_scene",
              artifact_ref: "local://video-orchestration/1/primary-scenes/scene-2.mp4",
              poster_ref: "local://video-orchestration/1/primary-scenes/scene-2.poster.jpg",
            },
            primary_visual_strategy: {
              mode: "evidence_card",
              business_hint: "missing_real_case_material",
            },
          },
        ],
      },
    }));

    expect(product.segments?.[0]).toMatchObject({
      id: "scene-2",
      isFallback: false,
      primaryVisualSourceType: "generated_scene",
      visualStatusLabel: "已生成画面",
      businessHint: "建议补充真实案例素材",
    });
    expect(product.segments?.[0]?.assetThumbnailUrl).toContain(
      "/v1/video/media?ref=local%3A%2F%2Fvideo-orchestration%2F1%2Fprimary-scenes%2Fscene-2.poster.jpg",
    );
  });

  it("consumes canonical visual treatment without exposing expression mode", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "completed",
      metadata: {
        capability: "video_project",
        video_plan: {
          scenes: [{
            id: "scene-expression",
            title: "三步流程",
            narration: "从资料到成片。",
            primary_visual_strategy: {
              mode: "mg_scene",
              visual_treatment: "material_enhanced",
              selection_reason: "流程关系比单张素材更容易理解。",
              graphic_component: "process_flow",
              background_policy: "verified_material_blur",
            },
            public_candidate_replacement: {
              old_provider_item_id: "old-1",
              new_provider_item_id: "new-2",
              reason_code: "remote_file_missing",
            },
          }],
        },
      },
    }));

    expect((product as unknown as Record<string, unknown>).expressionModeLabel).toBeUndefined();
    expect((product as unknown as Record<string, unknown>).expressionReason).toBeUndefined();
    expect(product.segments?.[0]).toMatchObject({
      primaryVisualTreatment: "material_enhanced",
      visualTreatmentLabel: "素材加图形 / 素材处理",
      selectionReason: "流程关系比单张素材更容易理解。",
      graphicComponentLabel: "流程图",
      backgroundTreatmentLabel: "已验证素材虚化背景",
      publicReplacementNote: "原公开素材已失效，已透明替换为可用素材",
    });
  });

  it("keeps export availability and local operation failure separate from product status", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "completed",
      operation_status: "failed",
      operation_failure_reason: "换素材失败",
      operation_failure_action: "retry",
      metadata: {
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: {
          timeline: { tracks: [], media: [] },
          mp4_state: "ready",
          mp4_ref: "local://exports/final.mp4",
        },
      },
    }));

    expect(product.productStatus).toBe("completed");
    expect(product.status).toBe("完成");
    expect(product.operationStatus).toBe("failed");
    expect(product.operationFailureReason).toBe("换素材失败");
    expect(product.sections.some((section) => section.title === "已有导出文件")).toBe(true);
  });

  it("maps approved product media as an available product interface", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
        video_segments: [
          {
            id: "scene-product-ui",
            title: "产品界面",
            narration: "上传资料后进入可编辑的视频工程。",
            asset_reference: { status: "no_asset_hit" },
            primary_visual: {
              status: "persisted",
              source_type: "product_asset",
              artifact_ref: "local://product-media/v1/workspace.png",
            },
          },
        ],
      },
    }));

    expect(product.segments?.[0]).toMatchObject({
      id: "scene-product-ui",
      isFallback: false,
      primaryVisualSourceType: "product_asset",
      visualStatusLabel: "产品界面",
    });
    expect(product.segments?.[0]?.assetThumbnailUrl).toContain(
      "/v1/video/media?ref=local%3A%2F%2Fproduct-media%2Fv1%2Fworkspace.png",
    );
  });

  it("prefers a streamable saved primary video over its private source snapshot", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
        video_segments: [
          {
            id: "scene-saved-video",
            title: "真实展厅",
            narration: "展示真实展厅环境。",
            asset_reference: {
              status: "matched",
              source_snapshot: {
                title: "真实展厅",
                original_ref: "local://content-assets/1/original/private-source",
              },
            },
            primary_visual: {
              status: "persisted",
              source_type: "saved_asset",
              artifact_ref: "local://video-orchestration/1/materials/showroom.mp4",
              poster_ref: "local://video-orchestration/1/materials/showroom.poster.jpg",
            },
          },
        ],
      },
    }));

    expect(product.segments?.[0]).toMatchObject({
      primaryVisualSourceType: "saved_asset",
      primaryVisualMediaType: "video",
    });
    expect(product.segments?.[0]?.assetThumbnailUrl).toContain(
      "/v1/video/media?ref=local%3A%2F%2Fvideo-orchestration%2F1%2Fmaterials%2Fshowroom.poster.jpg",
    );
    expect(product.segments?.[0]?.assetThumbnailUrl).not.toContain("content-assets");
  });

  it("does not request private saved refs before manifest materialization", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_script",
      status: "draft",
      metadata: {
        capability: "video_script",
        video_segments: [
          {
            id: "scene-private-saved",
            title: "确认前真实素材",
            narration: "等待视频工程持久化素材。",
            asset_reference: {
              status: "matched",
              source_snapshot: {
                title: "真实展厅",
                original_ref: "local://content-assets/1/original/private-source",
              },
            },
            materials: [{
              asset_id: 4,
              url: "local://content-assets/1/original/private-source",
            }],
            primary_visual: {
              status: "persisted",
              source_type: "saved_asset",
              artifact_ref: "local://content-assets/1/original/private-source",
            },
          },
        ],
      },
    }));

    expect(product.segments?.[0]).toMatchObject({
      primaryVisualSourceType: "saved_asset",
    });
    expect(product.segments?.[0]?.assetThumbnailUrl).toBeUndefined();
    expect(product.segments?.[0]?.primaryVisualMediaType).toBeUndefined();
  });

  it("projects real video-project track timing onto semantic scenes", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      metadata: {
        capability: "video_project",
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
      content_type: "video_project",
      status: "failed",
      product_status: "failed",
      failure_reason: "TTS provider timeout",
      failure_action: "retry",
      error_message: "TTS provider timeout",
      metadata: {
        capability: "video_project",
        capability_label: "视频编排",
        latest_job_public_id: "video-job-abc"
      }
    }));

    expect(product.status).toBe("失败");
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

  it("projects every two-stage runtime value to a restrained user-facing state", () => {
    expect(videoJobStageLabel("asset_driven_planning")).toBe("正在准备分镜画面");
    expect(videoJobStageLabel("planning_assets")).toBe("正在准备素材");
    expect(videoJobStageLabel("asset_manifest_ready")).toBe("正在准备素材");
    expect(videoJobStageLabel("composing")).toBe("正在生成视频");
    expect(videoJobStageLabel("voice")).toBe("正在生成视频");
    expect(videoJobStageLabel("project")).toBe("正在生成视频");
    expect(videoJobStageLabel("rendering")).toBe("正在生成视频");
    expect(videoJobStageLabel("reviewing")).toBe("正在完成质量检查");
    expect(videoJobStageLabel("quality")).toBe("正在完成质量检查");
    expect(videoJobStageLabel("needs_script_revision")).toBe("需要调整编导脚本");
  });

  it("maps stages onto ordered progress steps", () => {
    expect(videoJobStepIndex("queued")).toBe(0);
    expect(videoJobStepIndex("script")).toBe(0);
    expect(videoJobStepIndex("segment")).toBe(1);
    expect(videoJobStepIndex("done")).toBe(3);
  });
});

describe("agent timeline steps", () => {
  it("maps backend steps[] with public elapsed labels", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "understand", label: "理解素材并写脚本", status: "done", elapsedLabel: "8秒" },
      { key: "plan", label: "匹配素材并合成配音", status: "run" },
      { key: "generate", label: "组装分镜与时间线", status: "wait" }
    ]);
    expect(steps.map((step) => step.status)).toEqual(["done", "run", "wait"]);
    expect(steps[0].elapsedLabel).toBe("8秒");
    expect(steps[1].elapsedLabel).toBeUndefined();
  });

  it("never forwards internal stage keys or backend labels into timeline copy", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "asset_manifest_ready", label: "Pexels provider asset_manifest_ready", status: "done" },
      { key: "reviewing", label: "strategy_version VLM pipeline review", status: "run" },
      { key: "future_internal_stage", label: "Remotion private stage", status: "wait" },
    ]);
    const visible = JSON.stringify(steps);
    expect(visible).not.toMatch(/asset_manifest|strategy_version|pexels|provider|vlm|pipeline|remotion|future_internal/i);
    expect(steps.map((step) => step.label)).toEqual([
      "正在准备素材",
      "正在完成质量检查",
      "正在处理视频",
    ]);
  });

  it("does not synthesize raw timing for execution summaries", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "create_job", label: "创建视频工程任务", status: "done" },
      { key: "prepare_scenes", label: "读取已确认方案并准备分镜", status: "done" },
    ]);
    expect(steps[1]).not.toHaveProperty("elapsedSeconds");
    expect(steps[1].elapsedLabel).toBeUndefined();
  });

  it("preserves a backend retry job id only when one exists", () => {
    const steps = agentTimelineStepsFromBackend([
      {
        key: "prepare_media",
        label: "匹配分镜素材并准备配音、字幕",
        status: "fail",
        retryJobId: "video-job-1",
      },
      { key: "build_project", label: "组装可编辑视频工程", status: "wait" },
    ]);
    expect(steps[0].retryJobId).toBe("video-job-1");
    expect(steps[1].retryJobId).toBeUndefined();
  });

  it("preserves an explicit public elapsed label and skips malformed backend steps", () => {
    const steps = agentTimelineStepsFromBackend([
      { key: "understand", label: "理解素材并写脚本", status: "done", elapsedLabel: "约 1 分钟" },
      { key: "", label: "no key", status: "done" }
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].elapsedLabel).toBe("约 1 分钟");
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

  it("maps video parameter confirmation transport fields", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-video-parameters",
        title: "视频参数",
        status: "ready",
        metadata: {},
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
        products: [],
        messages: [{
          id: 1,
          role: "assistant",
          text: "请确认视频参数",
          asset_id: null,
          created_at: "2026-07-29T00:00:00Z",
          metadata: {
            plan: {
              kind: "video_parameter_confirmation",
              title: "确认视频参数",
              status: "pending",
              fields: [
                { key: "ratio", label: "视频比例", value: "横屏 16:9（默认）" },
                { key: "duration", label: "目标时长", value: "30 秒（默认）" },
              ],
              ratio_options: [
                { value: "16:9", label: "横屏 16:9" },
                { value: "9:16", label: "竖屏 9:16" },
              ],
              ratio_default: "16:9",
              duration_seconds: 30,
              duration_min: 5,
              duration_max: 120,
              pending_intent_id: "pending-1",
              pending_intent_version: 2,
            },
          },
        }],
      },
      newConversationProduct,
    );

    expect(conversation.messages?.[0]?.plan).toMatchObject({
      kind: "video_parameter_confirmation",
      ratioDefault: "16:9",
      durationSeconds: 30,
      durationMin: 5,
      durationMax: 120,
      pendingIntentId: "pending-1",
      pendingIntentVersion: 2,
    });
  });

  it("maps presenter visual events and material gaps from the authoritative plan scenes", () => {
    const product = contentAssetToProduct(asset({
      asset_kind: "video",
      content_type: "video_project",
      metadata: {
        capability: "video_project",
        video_plan: {
          video_type: "presenter",
          transcript: {
            words: [
              { id: "pw-1", text: "先看" },
              { id: "pw-2", text: "产品" },
            ],
          },
          scenes: [{
            id: "scene-1",
            visual_events: [
              {
                event_id: "event-text",
                type: "text_emphasis",
                start_word_id: "pw-1",
                end_word_id: "pw-1",
                purpose: "强调动作",
                presentation: "keyword_reveal",
                status: "planned",
                required_for_publish: false,
              },
              {
                event_id: "event-takeover",
                type: "media_takeover",
                start_word_id: "pw-2",
                end_word_id: "pw-2",
                purpose: "展示产品",
                presentation: "full_frame",
                status: "failed",
                required_for_publish: true,
              },
            ],
            material_gap: { message: "缺少产品录屏，当前保持人物画面" },
          }],
        },
        video_project: {
          version: "multimix_video_project_v1",
          segments: [{ id: "scene-1", title: "产品说明", narration: "先看产品" }],
        },
      },
    }));

    expect(product.segments?.[0]).toMatchObject({
      isPresenter: true,
      presenterMaterialGap: "缺少产品录屏，当前保持人物画面",
      presenterEvents: [
        {
          id: "event-text",
          type: "text_emphasis",
          label: "文字强调",
          spokenText: "先看",
          purpose: "强调动作",
          statusLabel: "待生成",
          requiredForPublish: false,
        },
        {
          id: "event-takeover",
          type: "media_takeover",
          label: "全屏素材",
          spokenText: "产品",
          purpose: "展示产品",
          statusLabel: "生成失败",
          requiredForPublish: true,
        },
      ],
    });
    expect(product.actions).toEqual(["调整口播包装", "修正字幕", "补充事件素材", "取消包装"]);
  });

  it("maps presenter direction samples for the combined confirmation card", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-presenter-direction",
        title: "口播方案",
        status: "ready",
        metadata: {},
        created_at: "2026-08-14T00:00:00Z",
        updated_at: "2026-08-14T00:00:00Z",
        products: [],
        messages: [{
          id: 1,
          role: "assistant",
          text: "请选择导演方向",
          asset_id: null,
          created_at: "2026-08-14T00:00:00Z",
          metadata: {
            plan: {
              kind: "presenter_project_confirmation",
              title: "口播型方案",
              status: "pending",
              fields: [{ key: "source_edit", label: "原话与删剪", value: "保留 42 秒" }],
              direction_default: "direction-a",
              direction_options: [{
                id: "direction-a",
                label: "观点与证据交替",
                concept: "人物建立信任，证据短时接管",
                reason: "原片观点清楚",
                recommended: true,
                sample_url: "local://presenter-samples/a.mp4",
                duration_seconds: 8,
              }],
            },
          },
        }],
      },
      newConversationProduct,
    );

    expect(conversation.messages?.[0]?.plan).toMatchObject({
      kind: "presenter_project_confirmation",
      directionDefault: "direction-a",
      directionOptions: [{
        id: "direction-a",
        recommended: true,
        durationSeconds: 8,
      }],
    });
    expect(conversation.messages?.[0]?.plan?.directionOptions?.[0]?.sampleUrl).toContain(
      "/v1/video/media?ref=",
    );
  });

  it("maps presenter audio selection bindings without dropping the preview", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-presenter-audio-selection",
        title: "选择口播原声",
        status: "ready",
        metadata: {},
        created_at: "2026-08-14T00:00:00Z",
        updated_at: "2026-08-14T00:00:00Z",
        products: [],
        messages: [{
          id: 1,
          role: "assistant",
          text: "请先选择原声",
          asset_id: 501,
          created_at: "2026-08-14T00:00:00Z",
          metadata: {
            plan: {
              kind: "presenter_audio_selection_confirmation",
              title: "选择口播原声",
              status: "pending",
              confirmation_id: "presenter-audio-selection-current",
              fields: [{ key: "audio_tracks", label: "有效人声音轨", value: "检测到 2 条" }],
              audio_track_default: 2,
              audio_track_options: [{
                stream_index: 2,
                label: "人声轨 2",
                preview_url: `local://presenter-previews/${"a".repeat(64)}/audio-track-2.m4a`,
                quality_score: 0.93,
                recommended: true,
                channels: 1,
                codec: "aac",
                audio_fingerprint: "sha256:audio-2",
                transcript_hash: "sha256:transcript-2",
              }],
            },
          },
        }],
      },
      newConversationProduct,
    );

    expect(conversation.messages?.[0]?.plan).toMatchObject({
      kind: "presenter_audio_selection_confirmation",
      confirmationId: "presenter-audio-selection-current",
      audioTrackDefault: 2,
      audioTrackOptions: [{
        streamIndex: 2,
        audioFingerprint: "sha256:audio-2",
        transcriptHash: "sha256:transcript-2",
      }],
    });
    expect(conversation.messages?.[0]?.plan?.audioTrackOptions?.[0]?.previewUrl).toContain(
      "/v1/video/media?ref=",
    );
  });

  it("keeps private content-asset plan refs as provenance without a thumbnail request", () => {
    const conversation = conversationFromPersisted(
      {
        id: "conv-private-plan-ref",
        title: "编导方案",
        status: "ready",
        metadata: {},
        created_at: "2026-07-08T00:00:00Z",
        updated_at: "2026-07-08T00:00:00Z",
        products: [],
        messages: [{
          id: 1,
          role: "assistant",
          text: "请确认方案",
          asset_id: null,
          created_at: "2026-07-08T00:00:00Z",
          metadata: {
            plan: {
              title: "视频方案",
              fields: [{
                key: "material",
                label: "真实素材",
                value: "展厅实拍",
                refs: [{
                  title: "真实展厅",
                  ref: "local://content-assets/1/original/private-video",
                }],
              }],
            },
          },
        }],
      },
      newConversationProduct,
    );

    expect(conversation.messages?.[0]?.plan?.fields[0]?.refs?.[0]).toMatchObject({
      title: "真实展厅",
    });
    expect(
      conversation.messages?.[0]?.plan?.fields[0]?.refs?.[0]?.thumbnailUrl,
    ).toBeUndefined();
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
