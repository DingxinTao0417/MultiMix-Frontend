import {
  API_BASE,
  type SegmentMaterialCandidatesResponse,
} from "./api";

export type VideoProjectJobResponse = {
  id: string;
  asset_id: number;
  status: string;
  workflow_stage?: string | null;
  error_message: string | null;
  project: Record<string, unknown> | null;
  steps?: Array<{
    key?: string;
    label?: string;
    status?: string;
    retry_job_id?: string | null;
  }> | null;
};

type RecomposePayload = {
  operation: string;
  candidate_id?: string;
  mg_enabled?: boolean;
  confirm_overwrite?: boolean;
};

export type SegmentRecomposeResult =
  | { kind: "confirm_overwrite"; message: string }
  | { kind: "started"; job: VideoProjectJobResponse };

function headers(token: string | null | undefined, json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function errorMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
  return typeof payload?.detail === "string" ? payload.detail : `HTTP ${response.status}`;
}

export async function getSegmentMaterialCandidates(args: {
  token: string | null | undefined;
  projectAssetId: string | number;
  segmentId: string;
  scope: "local" | "public";
  cursor?: string | null;
  limit?: number;
}): Promise<SegmentMaterialCandidatesResponse> {
  const params = new URLSearchParams({ scope: args.scope });
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.limit) params.set("limit", String(args.limit));
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(String(args.projectAssetId))}/segments/${encodeURIComponent(args.segmentId)}/material-candidates?${params.toString()}`,
    { headers: headers(args.token) },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<SegmentMaterialCandidatesResponse>;
}

export async function submitSegmentRecompose(args: {
  token: string | null | undefined;
  projectAssetId: string | number;
  segmentId: string;
  body: RecomposePayload;
}): Promise<SegmentRecomposeResult> {
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(String(args.projectAssetId))}/segments/${encodeURIComponent(args.segmentId)}/recompose`,
    {
      method: "POST",
      headers: headers(args.token, true),
      body: JSON.stringify(args.body),
    },
  );
  const payload = await response.json().catch(() => null) as { detail?: unknown } | VideoProjectJobResponse | null;
  const detail = payload && typeof payload === "object" && "detail" in payload ? payload.detail : null;
  if (
    response.status === 409
    && detail
    && typeof detail === "object"
    && "code" in detail
    && detail.code === "timeline_dirty"
  ) {
    const message = "message" in detail && typeof detail.message === "string"
      ? detail.message
      : "重新合成会覆盖现有手工剪辑，是否继续？";
    return { kind: "confirm_overwrite", message };
  }
  if (!response.ok || !payload || typeof payload !== "object" || !("id" in payload)) {
    throw new Error(typeof detail === "string" ? detail : `HTTP ${response.status}`);
  }
  return { kind: "started", job: payload as VideoProjectJobResponse };
}

export function recomposeSegmentMaterial(args: {
  token: string | null | undefined;
  projectAssetId: string | number;
  segmentId: string;
  candidateId: string;
  confirmOverwrite?: boolean;
}): Promise<SegmentRecomposeResult> {
  return submitSegmentRecompose({
    ...args,
    body: {
      operation: "replace_material",
      candidate_id: args.candidateId,
      confirm_overwrite: args.confirmOverwrite ?? false,
    },
  });
}

export async function getVideoProjectJob(args: {
  token: string | null | undefined;
  jobId: string;
}): Promise<VideoProjectJobResponse> {
  const response = await fetch(
    `${API_BASE}/v1/video/jobs/${encodeURIComponent(args.jobId)}`,
    { headers: headers(args.token) },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<VideoProjectJobResponse>;
}

export type FilmReviewFinding = {
  id: string;
  scene_id: string;
  category: string;
  severity: "P1" | "P2";
  reason: string;
  suggestion: string;
  start_seconds: number;
  end_seconds: number;
  evidence_ids: string[];
};

export type FilmReviewReport = {
  mode: "script" | "film";
  status: "reviewed" | "partial" | "unavailable";
  is_current?: boolean;
  summary: string;
  coverage: Record<string, string>;
  notes?: string[];
  findings: FilmReviewFinding[];
  follow_up: Array<{
    issue_id: string;
    issue: FilmReviewFinding;
    status: "open" | "resolved" | "unverified";
    evidence_ids: string[];
  }>;
  evidence?: Array<{ id: string; kind: string; description: unknown; display_text?: string }>;
};

export type FilmReviewJob = {
  id: string;
  status: string;
  is_current: boolean;
  report: FilmReviewReport | null;
  error: string | null;
  created_at: string | null;
  requested_repairs: string[];
};

export type FilmReviewState = {
  audio_direction?: Record<string, { emphasis: string; status: string }>;
  can_review: boolean;
  unavailable_reason: string | null;
  script_review: FilmReviewReport | null;
  reviews: FilmReviewJob[];
};

type FilmReviewArgs = { token: string | null | undefined; projectAssetId: string | number };

export async function getFilmReviews(args: FilmReviewArgs & { signal?: AbortSignal }): Promise<FilmReviewState> {
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(String(args.projectAssetId))}/reviews`,
    { headers: headers(args.token), signal: args.signal },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<FilmReviewState>;
}

export async function startFilmReview(args: FilmReviewArgs): Promise<FilmReviewJob> {
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(String(args.projectAssetId))}/reviews`,
    { method: "POST", headers: headers(args.token) },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<FilmReviewJob>;
}

export async function requestFilmReviewRepair(args: FilmReviewArgs & { reviewId: string; issueId: string }): Promise<void> {
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(String(args.projectAssetId))}/reviews/${encodeURIComponent(args.reviewId)}/issues/${encodeURIComponent(args.issueId)}/repair`,
    { method: "POST", headers: headers(args.token) },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
}
