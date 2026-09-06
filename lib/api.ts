// Backend API client for the MultiMix unified backend.
// Keeps the assets/conversation surface used by the MultiMix workspace.
// plus a single base-URL resolution and Bearer token injection.

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export const API_BASE = CONFIGURED_API_BASE ?? "http://127.0.0.1:8199";
export const API_CONNECTION_ERROR = "MULTIMIX_API_CONNECTION_ERROR";
export const MESSAGE_NOT_SUBMITTED_ERROR = "MULTIMIX_MESSAGE_NOT_SUBMITTED";
export const API_AUTH_EXPIRED_EVENT = "multimix:auth-expired";
export const VIDEO_WRITES_PAUSED =
  process.env.NEXT_PUBLIC_MULTIMIX_VIDEO_WRITES_PAUSED === "true";
export const VIDEO_WRITES_PAUSED_MESSAGE =
  "视频生成与修改暂时维护中，请稍后重试；已有内容仍可浏览。";

const TRANSIENT_UPLOAD_STATUSES = new Set([502, 503, 504]);
const UPLOAD_RETRY_DELAY_MS = 300;

// Whether a real backend is configured. When false, callers show an explicit
// unconfigured state and must not fabricate runtime data.
export const isApiConfigured = Boolean(CONFIGURED_API_BASE);

// Dispatch when a 401 is received so the auth shell can clear the session.
function notifyAuthExpired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(API_AUTH_EXPIRED_EVENT));
  }
}

type ApiError = Error & { retryable?: boolean; status?: number };

function nonRetryableError(message: string, status?: number): ApiError {
  const error = new Error(message) as ApiError;
  error.retryable = false;
  error.status = status;
  return error;
}

export function apiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isConnectionError(error: Error): boolean {
  return /failed to fetch|networkerror|err_failed|load failed|fetch/i.test(error.message);
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    if (Array.isArray(detail)) {
      const firstMessage = detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const message = (item as { msg?: unknown }).msg;
            return typeof message === "string" ? message : "";
          }
          return "";
        })
        .find(Boolean);
      if (firstMessage) return firstMessage;
    }
  }
  return fallback || "Request failed";
}

export async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    if (response.status === 401) {
      notifyAuthExpired();
    }

    const body = await response.json().catch(() => ({ detail: response.statusText }));
    if (
      response.status === 503
      && body
      && typeof body === "object"
      && "code" in body
      && (body as { code?: unknown }).code === "database_temporarily_unavailable"
    ) {
      throw new Error(API_CONNECTION_ERROR);
    }
    throw nonRetryableError(responseErrorMessage(body, response.statusText), response.status);
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Request failed");
    if (init.signal?.aborted || err.name === "AbortError") throw err;
    if ((err as ApiError).retryable === false) throw err;
    if (isConnectionError(err)) throw new Error(API_CONNECTION_ERROR);
    throw err;
  }
}

export async function apiBlob(path: string, token: string | null, init: RequestInit = {}): Promise<Blob> {
  try {
    const response = await fetch(`${API_BASE}/v1${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    });
    if (response.ok) return await response.blob();
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw nonRetryableError(responseErrorMessage(body, response.statusText));
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Request failed");
    if ((err as ApiError).retryable === false) throw err;
    if (isConnectionError(err)) throw new Error(API_CONNECTION_ERROR);
    throw err;
  }
}

// Multipart upload (no Content-Type header so the browser sets the boundary).
export async function apiForm<T>(path: string, token: string | null, formData: FormData): Promise<T> {
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetch(`${API_BASE}/v1${path}`, {
        method: "POST",
        body: formData,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!TRANSIENT_UPLOAD_STATUSES.has(response.status) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_DELAY_MS));
    }
    if (!response) throw new Error("Request failed");
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw nonRetryableError(responseErrorMessage(body, response.statusText));
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Request failed");
    if ((err as ApiError).retryable === false) throw err;
    if (isConnectionError(err)) throw new Error(API_CONNECTION_ERROR);
    throw err;
  }
}

// ---- Backend response types (mirror the MultiMix assets API) ----
export type ContentAssetVersion = {
  id: number;
  asset_id: number;
  parent_version_id?: number | null;
  version: number;
  title: string;
  body: string;
  instruction?: string | null;
  edit_intent?: string | null;
  diff_summary?: string | null;
  created_at: string;
};

export type ContentAsset = {
  id: number;
  project_id: number | null;
  parent_asset_id: number | null;
  library_kind?: "assets" | "copy" | "image" | "video" | string;
  asset_kind: "asset" | "copy" | "video" | "image" | string;
  content_type: string;
  title: string;
  status: "processing" | "ready" | "failed" | "draft" | "archived" | string;
  source_type?: string;
  generation_state?: string;
  source_filename: string | null;
  source_content_type: string | null;
  original_ref: string | null;
  markdown_ref: string | null;
  content_hash: string | null;
  body: string;
  metadata: Record<string, unknown>;
  source_mapping?: Array<Record<string, unknown>>;
  linked_asset_ids: number[];
  linked_event_ids: number[];
  archived: boolean;
  error_message: string | null;
  product_status?: "generating" | "completed" | "failed" | null;
  product_completed?: boolean;
  failure_reason?: string | null;
  failure_action?: "retry" | "modify_script" | "replace_scene_asset" | null;
  failure_scene_id?: string | null;
  operation_status?: "generating" | "completed" | "failed" | null;
  operation_failure_reason?: string | null;
  operation_failure_action?: "retry" | "modify_script" | "replace_scene_asset" | null;
  operation_failure_scene_id?: string | null;
  created_at: string;
  updated_at: string;
  versions: ContentAssetVersion[];
};

export type VideoPrimaryVisualRead = {
  status: "planned" | "persisted" | "failed" | string;
  source_type: "saved_asset" | "public_asset" | "product_asset" | "generated_scene" | string;
  asset_id?: number | null;
  artifact_ref?: string | null;
  preview_ref?: string | null;
};

export type AssetConversationMessageItemResponse = {
  id: number;
  role: "user" | "assistant";
  text: string;
  asset_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AssetConversationProjectResourcesResponse = {
  sources: ContentAsset[];
  copies: ContentAsset[];
  covers: ContentAsset[];
  videos: ContentAsset[];
};

export type ProjectProgressCode =
  | "needs_input"
  | "script_review"
  | "generating"
  | "ready"
  | "needs_attention";

export type ProjectResourceSummaryResponse = {
  sources: number;
  historical_sources: number;
  copies: number;
  covers: number;
  videos: number;
};

export type ProjectResourceKind = "source" | "copy" | "cover" | "video";
export type ProjectResourceScope = "active" | "history" | "all";

export type ProjectResourceItemResponse = {
  id: number;
  title: string;
  kind: ProjectResourceKind;
  membership_state: "active" | "removed" | null;
  historical_reference_count: number;
  status: string;
  asset_kind: string;
  content_type: string;
  source_type: string;
  updated_at: string;
};

export type ProjectResourcePageResponse = {
  items: ProjectResourceItemResponse[];
  total: number;
  offset: number;
  limit: number;
};

export type ProjectSourceMembershipResponse = {
  conversation_id: string;
  asset_id: number;
  state: "active" | "removed";
  active_source_count: number;
  historical_reference_count: number;
  notice: string;
};

export type AssetConversationResponse = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  project_state?: { code: ProjectProgressCode };
  messages: AssetConversationMessageItemResponse[];
  products: ContentAsset[];
  // A server-owned project view of the material and deliverables associated
  // with this conversation. Older servers may omit it while a detail reload
  // is in flight, in which case the UI keeps the project summary hidden.
  project_resources?: AssetConversationProjectResourcesResponse;
  project_resource_summary?: ProjectResourceSummaryResponse;
  agent_tasks?: AgentTaskCollectionResponse;
  active_agent_action?: AgentActionRunResponse | null;
  created_at: string;
  updated_at: string;
};

export type AssetConversationSummaryResponse = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  project_state?: { code: ProjectProgressCode };
  created_at: string;
  updated_at: string;
};

export type AssetConversationMessageResponse = {
  conversation_id: string;
  conversation: AssetConversationResponse;
  user_message: string;
  assistant_message: string;
  intent: Record<string, unknown>;
  suggestions: string[];
  suggestion_actions?: Array<Record<string, unknown>>;
  product: ContentAsset | null;
  generation_job?: AssetGenerationJobResponse | null;
  agent_action?: AgentActionRunResponse | null;
};

export type AgentActionStatus =
  | "planned"
  | "waiting_confirmation"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "canceled";

export type AgentActionRunResponse = {
  id: string;
  status: AgentActionStatus;
  requires_confirmation: boolean;
  confirmation_id: string | null;
  asset_id: number | null;
  version_id: number | null;
  message: string;
  retryable: boolean;
};

export type AgentTaskSummaryResponse = {
  goal: string;
  status: string;
  asset_id: number | null;
  version_id: number | null;
  scene_id: string | null;
};

export type AgentTaskCollectionResponse = {
  active: AgentTaskSummaryResponse | null;
  paused: AgentTaskSummaryResponse[];
};

export type AssetGenerationJobResponse = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result_asset_id: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  failure_diagnostic?: {
    error_code?: string;
    stage?: string;
    http_status?: number;
    provider_error_code?: string;
    request_fingerprint?: string;
    attempts?: number;
    fallback?: string;
  };
  progress_events?: Array<{
    key: string;
    label: string;
    detail: string;
    status: "active" | "completed";
    occurred_at: string;
  }>;
};

export type ContentAssetSearchResult = {
  asset: ContentAsset;
  snippet: string;
  score: number;
  matched_fields: string[];
};

export type PublicSourceRead = {
  provider: string;
  name: string;
  enabled: boolean;
  media_types: string[];
  license_policy: string;
  health_status?: string;
  last_checked_at?: string | null;
};

export type PublicMaterialCandidate = {
  id: string;
  title: string;
  media_type: "text" | "image" | "video";
  provider: string;
  source_url: string;
  preview_url: string;
  download_url: string;
  license: string;
  license_label: string;
  creator: string;
  body_text?: string;
  understanding: {
    status?: string;
    updated_at?: string;
    tags?: string[];
    caption?: string;
    objects?: string[];
    storyboard_roles?: Array<Record<string, unknown>>;
    scene_types?: Array<Record<string, unknown>>;
    fit_reason?: string;
    confidence?: number;
    error?: string | null;
  };
};

// Unified segment material candidate (backend
// GET .../segments/{id}/material-candidates). Public rows never carry a
// download URL; the server keeps it and resolves it on selection by candidate_id.
export type SegmentMaterialCandidateResponse = {
  candidate_id: string | null;
  source_type: "saved_asset" | "public_asset" | "title_card";
  source_asset_id: number | null;
  provider: string;
  provider_item_id: string;
  media_type: string;
  title: string;
  preview_url: string;
  width: number;
  height: number;
  duration: number;
  license: string;
  author: string;
  attribution_url: string;
  verification_status: string;
  relevance_status: string;
  relevance_reason: string;
  requires_trim: boolean;
  already_persisted: boolean;
  selectable: boolean;
};

export type SegmentMaterialCandidatesResponse = {
  scope: "local" | "public";
  segment_id: string;
  groups: {
    current: SegmentMaterialCandidateResponse[];
    recommended: SegmentMaterialCandidateResponse[];
    library: SegmentMaterialCandidateResponse[];
    public: SegmentMaterialCandidateResponse[];
  };
  provider_statuses: Array<{ provider: string; status: string }>;
  next_cursor: string | null;
};

export type AssetIngestJobRead = {
  id: string;
  asset_id: number;
  status: string;
  error_message: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

// Partial payload returned by the retry/process ingest-job actions; the backend
// does not echo the full job row for these endpoints.
export type AssetIngestJobActionRead = {
  id: string;
  asset_id: number;
  status: string;
  error_message: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

export type ContentAssetRevisionResponse = {
  asset: ContentAsset;
  parent_version_id: number | null;
  version_id: number;
  diff_summary: string;
  assistant_message: string;
  suggestions: string[];
  suggestion_actions?: Array<Record<string, unknown>>;
};

export type ContentAssetVersionCompareResponse = {
  asset_id: number;
  from_version_id: number;
  to_version_id: number;
  summary: string;
  from_version: number;
  to_version: number;
  length_delta: number;
};

export type VideoRenderJobCreateResponse = {
  job: {
    id: string;
    status: string;
    workflow_stage?: string | null;
    error_message: string | null;
    mp4_ref: string | null;
  };
  product: ContentAsset;
  render_product?: ContentAsset | null;
};

export type AssetLlmDiagnosticsRead = {
  configured: boolean;
  provider: string;
  model: string | null;
  timeout_seconds: number;
  max_input_chars: number;
  probe_requested: boolean;
  probe_ok: boolean | null;
  probe_error: string | null;
};

export type AuthResponse = {
  access_token: string | null;
  token_type: string;
  verification_required: boolean;
  email: string | null;
  message: string | null;
};

export type AdminProductMetrics = {
  window_days: 7 | 30 | 90;
  generated_at: string;
  totals: {
    registered_users: number;
    workspace_users: number;
    activated_users: number;
    editable_video_users: number;
    modified_video_users: number;
    exported_video_users: number;
  };
  funnel: Array<{ key: string; label: string; users: number }>;
  rates: {
    activation_rate: number;
    editable_video_rate: number;
    modified_video_rate: number;
    exported_video_rate: number;
    saved_asset_scene_rate: number;
    source_evidence_open_rate: number;
    recommendation_select_rate: number;
  };
  durations: {
    time_to_first_editable_video_seconds_median: number | null;
    time_to_first_editable_video_seconds_p75: number | null;
  };
  daily: Array<{
    date: string;
    registered_users: number;
    activated_users: number;
    editable_video_users: number;
  }>;
};

// Local auth (MULTIMIX_AUTH_PROVIDER=local). Email verification is off by default.
export async function authLogin(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>("/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function authRegister(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>("/auth/register", null, {
    method: "POST",
    body: JSON.stringify({ email, password, locale: "zh", region: "global" })
  });
}

export async function authLocalDevAdmin(): Promise<AuthResponse> {
  return api<AuthResponse>("/auth/local-dev-admin", null);
}

export async function getAdminProductMetrics(
  token: string,
  windowDays: 7 | 30 | 90 = 30,
): Promise<AdminProductMetrics> {
  return api<AdminProductMetrics>(
    `/admin/product-metrics?window_days=${windowDays}`,
    token,
    { cache: "no-store" },
  );
}

export async function getAssetLlmDiagnostics(token: string, probe = true): Promise<AssetLlmDiagnosticsRead> {
  return api<AssetLlmDiagnosticsRead>(`/assets/llm/diagnostics?probe=${probe ? "true" : "false"}`, token);
}

export type AssetFeatureAvailabilityRead = {
  flux_image_user_entry_enabled: boolean;
};

export async function getAssetFeatureAvailability(token: string): Promise<AssetFeatureAvailabilityRead> {
  return api<AssetFeatureAvailabilityRead>("/assets/features", token);
}

// Turn an arbitrary send/generation error into a user-facing Chinese message.
export function formatComposerError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return "发送失败，请稍后重试。";
  if (message === API_CONNECTION_ERROR) return "无法连接后端服务，请稍后重试。";
  if (message === MESSAGE_NOT_SUBMITTED_ERROR) return "未提交：后端没有记录这次操作，可以重试。";
  const lower = message.toLowerCase();
  if (
    lower.includes("timed out")
    || lower.includes("timeout")
    || lower.includes("provider_timeout")
    || lower.includes("provider_stalled")
  ) {
    return "内容生成超时，本轮没有创建产物，可以直接重试。";
  }
  if (/[一-鿿]/.test(message)) return message;
  if (lower.includes("quota exceeded") || lower.includes("payment required")) {
    return "本月生成额度已用完，请升级配额或下月再试。";
  }
  if (lower.includes("database request failed") || lower.includes("internal server error")) {
    return "对话保存或生成失败，请稍后重试。";
  }
  if (lower.includes("not configured") || lower.includes("llm") || lower.includes("ai provider")) {
    return "LLM 暂时不可用，当前对话还没有生成产物。";
  }
  if (lower.includes("unreachable") || lower.includes("bad gateway") || lower.includes("service failed")) {
    return "生成服务暂时不可达，请稍后重试。";
  }
  return "发送失败，请稍后重试。";
}

export async function getAssetGenerationJob(
  token: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<AssetGenerationJobResponse> {
  return api<AssetGenerationJobResponse>(
    `/assets/generation-jobs/${encodeURIComponent(jobId)}`,
    token,
    { signal, cache: "no-store" },
  );
}

export async function getProjectResources(
  token: string,
  conversationId: string,
  kind: ProjectResourceKind,
  scope: ProjectResourceScope,
  offset = 0,
  limit = 20,
): Promise<ProjectResourcePageResponse> {
  const query = new URLSearchParams({
    kind,
    scope,
    offset: String(offset),
    limit: String(limit),
  });
  return api<ProjectResourcePageResponse>(
    `/assets/conversations/${encodeURIComponent(conversationId)}/resources?${query.toString()}`,
    token,
    { cache: "no-store" },
  );
}

export async function addProjectSource(
  token: string,
  conversationId: string,
  assetId: number,
): Promise<ProjectSourceMembershipResponse> {
  return api<ProjectSourceMembershipResponse>(
    `/assets/conversations/${encodeURIComponent(conversationId)}/sources/${assetId}`,
    token,
    { method: "PUT" },
  );
}

export async function removeProjectSource(
  token: string,
  conversationId: string,
  assetId: number,
): Promise<ProjectSourceMembershipResponse> {
  return api<ProjectSourceMembershipResponse>(
    `/assets/conversations/${encodeURIComponent(conversationId)}/sources/${assetId}`,
    token,
    { method: "DELETE" },
  );
}

export async function getContentAssetVersionPreview(
  token: string,
  assetId: number,
  versionId: number,
): Promise<ContentAsset> {
  return api<ContentAsset>(
    `/assets/${assetId}/versions/${versionId}/preview`,
    token,
    { cache: "no-store" },
  );
}

export async function retryAssetGenerationJob(
  token: string,
  jobId: string,
): Promise<AssetGenerationJobResponse> {
  return api<AssetGenerationJobResponse>(
    `/assets/generation-jobs/${encodeURIComponent(jobId)}/retry`,
    token,
    { method: "POST" },
  );
}

export async function cancelAssetGenerationJob(
  token: string,
  jobId: string,
): Promise<AssetGenerationJobResponse> {
  return api<AssetGenerationJobResponse>(
    `/assets/generation-jobs/${encodeURIComponent(jobId)}/cancel`,
    token,
    { method: "POST" },
  );
}

export async function getConversationAgentAction(
  token: string,
  conversationId: string,
  actionRunId: string,
  signal?: AbortSignal,
): Promise<AgentActionRunResponse> {
  return api<AgentActionRunResponse>(
    `/assets/conversations/${encodeURIComponent(conversationId)}/agent-actions/${encodeURIComponent(actionRunId)}`,
    token,
    { signal, cache: "no-store" },
  );
}

export async function retryConversationAgentAction(
  token: string,
  conversationId: string,
  actionRunId: string,
): Promise<AgentActionRunResponse> {
  return api<AgentActionRunResponse>(
    `/assets/conversations/${encodeURIComponent(conversationId)}/agent-actions/${encodeURIComponent(actionRunId)}/retry`,
    token,
    { method: "POST" },
  );
}
