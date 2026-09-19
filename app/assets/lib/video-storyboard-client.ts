import { api } from "../../../lib/api";

export type VideoStoryboardScene = {
  scene_id: string;
  ordinal: number;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  title: string;
  description: string;
  confidence: number;
  status: "ready" | "needs_review";
  preview_url: string;
};

export type VideoStoryboard = {
  schema_version: "external_video_storyboard_v1";
  status: "ready" | "needs_review";
  source_asset_id: number;
  storyboard_fingerprint: string;
  duration_seconds: number;
  scene_count: number;
  scenes: VideoStoryboardScene[];
};

export type VideoStoryboardAnimationJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  scene_id: string;
  style: VideoStoryboardAnimationStyle;
  result_asset_id: number | null;
  generation: { estimated_standard_cost_cny?: number; billed_seconds?: number } | null;
  error_code: string | null;
  message: string | null;
};

export type VideoStoryboardAnimationStyle = "motion_illustration_v1" | "generative_animation_v1";

export type VideoStoryboardJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: "queued" | "reading_source" | "analyzing" | "done" | "failed";
  retryable: boolean;
  message: string | null;
  error_code: string | null;
  storyboard: VideoStoryboard | null;
  follow_up_status: "needs_confirmation" | "animation_queued" | "failed" | null;
  animation_job_id: string | null;
  animation_job_status: VideoStoryboardAnimationJob["status"] | null;
};

export function getVideoStoryboard(token: string, assetId: number): Promise<VideoStoryboard> {
  return api<VideoStoryboard>(`/assets/${assetId}/storyboard`, token);
}

export function createVideoStoryboard(token: string, assetId: number): Promise<VideoStoryboardJob> {
  return api<VideoStoryboardJob>(`/assets/${assetId}/storyboard`, token, { method: "POST" });
}

export function getLatestVideoStoryboardJob(token: string, assetId: number): Promise<VideoStoryboardJob> {
  return api<VideoStoryboardJob>(`/assets/${assetId}/storyboard/jobs/latest`, token);
}

export function getVideoStoryboardJob(
  token: string, assetId: number, jobId: string,
): Promise<VideoStoryboardJob> {
  return api<VideoStoryboardJob>(
    `/assets/${assetId}/storyboard/jobs/${encodeURIComponent(jobId)}`, token,
  );
}

export function retryVideoStoryboardJob(
  token: string, assetId: number, jobId: string,
): Promise<VideoStoryboardJob> {
  return api<VideoStoryboardJob>(
    `/assets/${assetId}/storyboard/jobs/${encodeURIComponent(jobId)}/retry`,
    token,
    { method: "POST" },
  );
}

export function confirmVideoStoryboard(token: string, assetId: number, fingerprint: string): Promise<VideoStoryboard> {
  return api<VideoStoryboard>(`/assets/${assetId}/storyboard/confirm`, token, {
    method: "POST",
    body: JSON.stringify({ storyboard_fingerprint: fingerprint }),
  });
}

export function animateVideoStoryboardScene(
  token: string, assetId: number, fingerprint: string, sceneOrdinal: number,
  style: VideoStoryboardAnimationStyle,
): Promise<VideoStoryboardAnimationJob> {
  return api<VideoStoryboardAnimationJob>(`/assets/${assetId}/storyboard/animate`, token, {
    method: "POST",
    body: JSON.stringify({ storyboard_fingerprint: fingerprint, scene_ordinal: sceneOrdinal, style }),
  });
}

export function getVideoStoryboardAnimationJob(
  token: string, assetId: number, jobId: string,
): Promise<VideoStoryboardAnimationJob> {
  return api<VideoStoryboardAnimationJob>(`/assets/${assetId}/storyboard/animate/${encodeURIComponent(jobId)}`, token);
}

export function getLatestVideoStoryboardAnimationJob(
  token: string, assetId: number,
): Promise<VideoStoryboardAnimationJob> {
  return api<VideoStoryboardAnimationJob>(`/assets/${assetId}/storyboard/animate/latest`, token);
}
