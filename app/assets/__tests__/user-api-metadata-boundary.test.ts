// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { conversationFromPersisted, statusLabelFromProduct } from "../../../lib/asset-mappers";
import type { AssetConversationResponse, ContentAsset } from "../../../lib/api";
import { persistedVideoExportMatchesCurrentProject } from "../components/product-preview";
import { assetGenerationJobsFromConversations, nextAssetGenerationPollState } from "../lib/asset-generation-poller";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { ProductArtifact } from "../lib/asset-workspace-shared";
import type { AssetProduct } from "../lib/asset-workspace-types";
import { longFormAnalysisFromMetadata } from "../lib/long-form-client";

const emptyProduct = {
  id: "empty-product",
  mode: "copy",
  title: "等待生成",
  status: "未生成",
  summary: "",
  ratio: "Markdown",
  duration: "0 段",
  phase: "等待指令",
  sections: [],
  timeline: [],
  actions: [],
} as AssetProduct;

function directorAsset(): ContentAsset {
  return {
    id: 41,
    project_id: null,
    parent_asset_id: null,
    library_kind: "video",
    asset_kind: "video",
    content_type: "video_script",
    title: "公开编导稿",
    status: "ready",
    source_type: "generated",
    generation_state: "director_script_draft",
    source_filename: null,
    source_content_type: null,
    original_ref: null,
    markdown_ref: null,
    content_hash: null,
    body: "# 公开编导稿",
    metadata: {
      capability_label: "编导稿",
      artifact_display_stage: "待确认",
      video_workflow_stage: "director_script_draft",
    },
    source_mapping: [],
    linked_asset_ids: [],
    linked_event_ids: [],
    archived: false,
    error_message: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    versions: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LLY-24 public user API contract", () => {
  it("maps explicit public task and action DTOs without agent_mission", () => {
    const row = {
      id: "asset-conversation-public",
      title: "公开任务会话",
      status: "active",
      metadata: { video_workflow_stage: "director_script_draft" },
      agent_tasks: {
        active: {
          goal: "继续调整视频分镜",
          status: "active",
          asset_id: 41,
          version_id: 3,
          scene_id: "scene-2",
        },
        paused: [{ goal: "补充产品素材", status: "paused", asset_id: 12 }],
      },
      active_agent_action: {
        id: "agent-action-public-1",
        status: "running",
        requires_confirmation: false,
        confirmation_id: null,
        asset_id: 41,
        version_id: 3,
        message: "正在替换第二段素材。",
        retryable: false,
      },
      messages: [{
        id: 1,
        role: "assistant",
        text: "正在替换第二段素材。",
        asset_id: 41,
        metadata: {
          agent_action_run_id: "agent-action-public-1",
          agent_action: {
            id: "agent-action-public-1",
            status: "running",
            requires_confirmation: false,
            confirmation_id: null,
            asset_id: 41,
            version_id: 3,
            message: "正在替换第二段素材。",
            retryable: false,
          },
        },
        created_at: "2026-08-14T00:00:00Z",
      }],
      products: [directorAsset()],
      created_at: "2026-08-14T00:00:00Z",
      updated_at: "2026-08-14T00:01:00Z",
    } as unknown as AssetConversationResponse;

    const conversation = conversationFromPersisted(row, emptyProduct);

    expect(conversation.agentTasks?.active).toMatchObject({
      goal: "继续调整视频分镜",
      status: "active",
      assetId: 41,
      versionId: 3,
      sceneId: "scene-2",
    });
    expect(conversation.agentTasks?.paused[0]).toMatchObject({
      goal: "补充产品素材",
      status: "paused",
      assetId: 12,
    });
    expect(conversation.activeAgentAction).toMatchObject({
      id: "agent-action-public-1",
      status: "running",
      assetId: 41,
      versionId: 3,
    });
    expect(conversation.messages?.[0]?.agentAction).toMatchObject({
      id: "agent-action-public-1",
      status: "running",
      assetId: 41,
    });
  });

  it("restores generation polling from public status fields only", () => {
    const jobs = assetGenerationJobsFromConversations([{
      id: "asset-conversation-generation",
      messages: [{
        role: "assistant",
        text: "内容生成失败，可以直接重试。",
        metadata: {
          asset_generation_job_id: "asset-generation-public-1",
          asset_generation_status: "failed",
          product_id: 91,
        },
      }],
    }]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].job).toMatchObject({
      id: "asset-generation-public-1",
      status: "failed",
      result_asset_id: 91,
      error_message: "内容生成失败，可以直接重试。",
    });
    expect(jobs[0].job).not.toHaveProperty("stage");
    expect(jobs[0].job).not.toHaveProperty("attempts");
    expect(jobs[0].job).not.toHaveProperty("error_code");

    const completed = nextAssetGenerationPollState({
      jobId: "asset-generation-public-1",
      status: "running",
      run: 1,
      refreshConversation: false,
      errorMessage: null,
    }, {
      id: "asset-generation-public-1",
      status: "completed",
      result_asset_id: 91,
      error_message: null,
      created_at: "2026-08-14T00:00:00Z",
      updated_at: "2026-08-14T00:01:00Z",
    });
    expect(completed.refreshConversation).toBe(true);
    expect(completed).not.toHaveProperty("stage");
  });

  it("uses public video workflow state and semantic steps instead of render_stage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "video-job-public-1",
      asset_id: 41,
      status: "running",
      workflow_stage: "material_search",
      steps: [{
        key: "materials",
        label: "准备分镜素材",
        status: "run",
      }],
      error_message: null,
      project: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const job = await assetWorkspaceAdapter.getVideoJob("token", "video-job-public-1");

    expect(job).toMatchObject({
      id: "video-job-public-1",
      assetId: 41,
      status: "running",
      workflowStage: "material_search",
      steps: [{ key: "materials", label: "准备分镜素材", status: "run" }],
    });
    expect(job).not.toHaveProperty("renderStage");
    expect(job.steps[0]).not.toHaveProperty("elapsedSeconds");
  });

  it("does not recreate source or project fingerprints in browser state", () => {
    const analysis = longFormAnalysisFromMetadata({
      schema_version: "long_form_candidate_set:v1",
      source_asset_id: 91,
      chapters: [],
      top_candidate_ids: ["candidate-1"],
      candidates: [{
        id: "candidate-1",
        title: "增长不能只看收入",
        why_publish: "观点完整",
        source_start_seconds: 12,
        source_end_seconds: 57,
        target_seconds: 45,
        core_quote: "增长不能只看收入",
        recommended_ratio: "9:16",
        visual_completeness: "complete",
        grounded: true,
      }],
    });
    expect(analysis).not.toHaveProperty("source_fingerprint");

    const staleProduct = {
      metadata: {
        video_export_current: false,
        video_project: { mp4_ref: "local://video-orchestration/final.mp4" },
      },
    } as unknown as ProductArtifact;
    expect(persistedVideoExportMatchesCurrentProject(staleProduct)).toBe(false);
  });

  it("keeps preparation-only presentation without the internal unsupported_adapter flag", () => {
    const preparationOnly = {
      ...directorAsset(),
      content_type: "cover_image",
      generation_state: "preparation_only",
      metadata: {},
    } as ContentAsset;

    expect(statusLabelFromProduct(preparationOnly)).toBe("可执行方案");
  });
});
