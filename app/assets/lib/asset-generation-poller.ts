import type { AssetGenerationJobResponse } from "../../../lib/api";

export type AssetGenerationPollState = {
  jobId: string;
  status: AssetGenerationJobResponse["status"];
  run: number;
  refreshConversation: boolean;
  errorMessage: string | null;
};

export type PersistedAssetGenerationJob = {
  conversationId: string;
  job: AssetGenerationJobResponse;
};

export function assetGenerationPollLifecycleKey(jobs: Array<{
  conversationId: string;
  job: AssetGenerationJobResponse;
  run: number;
}>): string {
  return jobs
    .map(({ conversationId, job, run }) => `${conversationId}:${job.id}:${run}`)
    .sort()
    .join(",");
}

export function assetGenerationJobsFromConversations(conversations: Array<{
  id: string;
  messages?: Array<{
    role: "user" | "assistant";
    text: string;
    metadata?: Record<string, unknown>;
  }>;
}>): PersistedAssetGenerationJob[] {
  const jobs = new Map<string, PersistedAssetGenerationJob>();
  for (const conversation of conversations) {
    for (const message of conversation.messages ?? []) {
      if (message.role !== "assistant") continue;
      const metadata = message.metadata ?? {};
      const id = typeof metadata.asset_generation_job_id === "string"
        ? metadata.asset_generation_job_id.trim()
        : "";
      const rawStatus = metadata.asset_generation_status;
      const status = rawStatus === "queued"
        || rawStatus === "running"
        || rawStatus === "completed"
        || rawStatus === "failed"
        || rawStatus === "cancelled"
        ? rawStatus
        : null;
      if (!id || !status || status === "completed") continue;
      jobs.set(id, {
        conversationId: conversation.id,
        job: {
          id,
          status,
          result_asset_id: typeof metadata.product_id === "number"
            ? metadata.product_id
            : null,
          error_message: status === "failed" || status === "cancelled" ? message.text : null,
          created_at: "",
          updated_at: "",
        },
      });
    }
  }
  return [...jobs.values()];
}

export function nextAssetGenerationPollState(
  current: AssetGenerationPollState,
  remote: AssetGenerationJobResponse,
): AssetGenerationPollState {
  if (current.jobId !== remote.id) return current;
  if (remote.status === "completed") {
    return {
      ...current,
      status: "completed",
      refreshConversation: true,
      errorMessage: null,
    };
  }
  if (remote.status === "failed") {
    return {
      ...current,
      status: "failed",
      refreshConversation: false,
      errorMessage: remote.error_message ?? "内容生成失败，本轮没有创建产物，可以直接重试。",
    };
  }
  if (remote.status === "cancelled") {
    return {
      ...current,
      status: "cancelled",
      refreshConversation: false,
      errorMessage: null,
    };
  }
  return {
    ...current,
    status: remote.status,
    refreshConversation: false,
    errorMessage: null,
  };
}
