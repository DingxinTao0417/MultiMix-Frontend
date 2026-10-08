import type { AssetGenerationJobResponse } from "../../../lib/api";
import { generationProgressEvents } from "./asset-generation-progress";

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
      const kind = metadata.asset_generation_progress_kind;
      const job: AssetGenerationJobResponse = {
        id, status,
        result_asset_id: typeof metadata.product_id === "number" ? metadata.product_id : null,
        error_message: status === "failed" || status === "cancelled" ? message.text : null,
        retryable: metadata.asset_generation_retryable === true,
        created_at: "", updated_at: "",
      };
      if (kind === "video_plan" || kind === "video_create" || kind === "video_update" || kind === "general") {
        job.progress_kind = kind;
      }
      if (Array.isArray(metadata.asset_generation_progress)) {
        job.progress_events = generationProgressEvents({
          ...job,
          progress_events: metadata.asset_generation_progress as AssetGenerationJobResponse["progress_events"],
        });
      }
      if (Array.isArray(metadata.asset_generation_scene_progress)) {
        job.scene_progress = metadata.asset_generation_scene_progress.filter((scene) => (
          Boolean(scene) && typeof scene === "object"
          && typeof (scene as Record<string, unknown>).scene_id === "string"
          && typeof (scene as Record<string, unknown>).scene_number === "number"
          && typeof (scene as Record<string, unknown>).title === "string"
          && ["processing", "completed", "failed"].includes(
            String((scene as Record<string, unknown>).status),
          )
        )) as AssetGenerationJobResponse["scene_progress"];
      }
      const wait = metadata.asset_generation_provider_wait;
      if (wait && typeof wait === "object") {
        const value = wait as Record<string, unknown>;
        if (
          typeof value.stage === "string"
          && ["requested", "first_response_received", "delayed"].includes(String(value.status))
          && (
            typeof value.budget_seconds === "number"
            || (
              typeof value.idle_timeout_seconds === "number"
              && typeof value.safety_timeout_seconds === "number"
            )
          )
          && typeof value.request_sent_at === "string"
          && typeof value.last_response_at === "string"
        ) {
          job.provider_wait = {
            stage: value.stage,
            status: value.status as NonNullable<AssetGenerationJobResponse["provider_wait"]>["status"],
            ...(typeof value.budget_seconds === "number" ? { budget_seconds: value.budget_seconds } : {}),
            ...(typeof value.idle_timeout_seconds === "number" ? { idle_timeout_seconds: value.idle_timeout_seconds } : {}),
            ...(typeof value.safety_timeout_seconds === "number" ? { safety_timeout_seconds: value.safety_timeout_seconds } : {}),
            request_sent_at: value.request_sent_at,
            ...(typeof value.first_response_at === "string" ? { first_response_at: value.first_response_at } : {}),
            last_response_at: value.last_response_at,
          };
        }
      }
      jobs.set(id, {
        conversationId: conversation.id,
        job,
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
