import { describe, expect, it } from "vitest";

import {
  assetGenerationPollLifecycleKey,
  assetGenerationJobsFromConversations,
  nextAssetGenerationPollState,
} from "../lib/asset-generation-poller";

const remote = (status: "queued" | "running" | "completed" | "failed") => ({
  id: "asset-generation-job-1",
  status,
  stage: status,
  attempts: status === "queued" ? 0 : 1,
  result_asset_id: status === "completed" ? 42 : null,
  error_code: status === "failed" ? "provider_timeout" : null,
  error_message: status === "failed"
    ? "内容生成超时，本轮没有创建产物，可以直接重试。"
    : null,
  created_at: "2026-07-17T06:00:00Z",
  updated_at: "2026-07-17T06:00:01Z",
});

describe("asset generation poller", () => {
  it("moves queued to running without refreshing the conversation", () => {
    const result = nextAssetGenerationPollState({
      jobId: "asset-generation-job-1",
      status: "queued",
      stage: "queued",
      run: 1,
      refreshConversation: false,
      errorMessage: null,
    }, remote("running"));

    expect(result.status).toBe("running");
    expect(result.refreshConversation).toBe(false);
  });

  it("marks completion for a conversation refresh", () => {
    const result = nextAssetGenerationPollState({
      jobId: "asset-generation-job-1",
      status: "running",
      stage: "generating",
      run: 1,
      refreshConversation: false,
      errorMessage: null,
    }, remote("completed"));

    expect(result.status).toBe("completed");
    expect(result.refreshConversation).toBe(true);
  });

  it("keeps the poll lifecycle alive while a completed job refreshes its conversation", () => {
    expect(assetGenerationPollLifecycleKey([{
      conversationId: "asset-conversation-1",
      job: remote("completed"),
      run: 1,
    }])).toBe("asset-conversation-1:asset-generation-job-1:1");
  });

  it("keeps a stale callback from overwriting a newer job", () => {
    const current = {
      jobId: "asset-generation-job-2",
      status: "queued" as const,
      stage: "queued",
      run: 2,
      refreshConversation: false,
      errorMessage: null,
    };

    expect(nextAssetGenerationPollState(current, remote("failed"))).toEqual(current);
  });

  it("keeps the controlled Chinese failure for retry", () => {
    const result = nextAssetGenerationPollState({
      jobId: "asset-generation-job-1",
      status: "running",
      stage: "generating",
      run: 1,
      refreshConversation: false,
      errorMessage: null,
    }, remote("failed"));

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("内容生成超时，本轮没有创建产物，可以直接重试。");
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
        },
      }],
    }]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].conversationId).toBe("asset-conversation-1");
    expect(jobs[0].job.error_code).toBe("provider_timeout");
    expect(jobs[0].job.error_message).toContain("内容生成超时");
  });
});
