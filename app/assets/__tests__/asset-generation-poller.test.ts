import { describe, expect, it } from "vitest";

import {
  assetGenerationPollLifecycleKey,
  assetGenerationJobsFromConversations,
} from "../lib/asset-generation-poller";

const remote = (status: "queued" | "running" | "completed" | "failed") => ({
  id: "asset-generation-job-1",
  status,
  result_asset_id: status === "completed" ? 42 : null,
  error_message: status === "failed"
    ? "内容生成超时，本轮没有创建产物，可以直接重试。"
    : null,
  created_at: "2026-07-17T06:00:00Z",
  updated_at: "2026-07-17T06:00:01Z",
});

describe("asset generation poller", () => {
  it("restores video purpose and real progress before the first network response", () => {
    const event = {
      key: "source_staging", label: "正在准备原片", detail: "",
      status: "active", occurred_at: "2026-09-15T06:00:00Z",
    };
    const scene = {
      scene_id: "scene-1", scene_number: 1, title: "开场",
      status: "completed", detail: "本镜素材已确认。", updated_at: "2026-09-15T06:00:01Z",
    };
    const restored = assetGenerationJobsFromConversations([{
      id: "conversation-1",
      messages: [{
        role: "assistant", text: "",
        metadata: {
          asset_generation_job_id: "video-job-1", asset_generation_status: "running",
          asset_generation_progress_kind: "video_plan", asset_generation_progress: [event],
          asset_generation_scene_progress: [scene],
        },
      }],
    }]);
    expect(restored[0].job).toMatchObject({
      progress_kind: "video_plan", progress_events: [event], scene_progress: [scene],
    });
  });

  it("keeps the poll lifecycle alive while a completed job refreshes its conversation", () => {
    expect(assetGenerationPollLifecycleKey([{
      conversationId: "asset-conversation-1",
      job: remote("completed"),
      run: 1,
    }])).toBe("asset-conversation-1:asset-generation-job-1:1");
  });

  it("restores a failed job from persisted conversation message metadata", () => {
    const jobs = assetGenerationJobsFromConversations([{
      id: "asset-conversation-1",
      messages: [{
        role: "assistant",
        text: "内容生成超时，本轮没有创建产物，可以直接重试。",
        metadata: {
          asset_generation_job_id: "asset-generation-job-1",
          asset_generation_status: "failed",
          asset_generation_stage: "failed",
          asset_generation_error_code: "provider_timeout",
          asset_generation_retryable: true,
        },
      }],
    }]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].conversationId).toBe("asset-conversation-1");
    expect(jobs[0].job).not.toHaveProperty("stage");
    expect(jobs[0].job).not.toHaveProperty("error_code");
    expect(jobs[0].job.error_message).toContain("内容生成超时");
    expect(jobs[0].job.retryable).toBe(true);
  });
});
