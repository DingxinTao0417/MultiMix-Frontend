// Backend API client for the MultiMix unified backend (ChangeIn FastAPI base).
// Trimmed from ChangeIn frontend/lib/api.ts: keeps the assets/conversation surface
// plus a single base-URL resolution and Bearer token injection.

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export const API_BASE = CONFIGURED_API_BASE ?? "http://127.0.0.1:8199";
export const API_CONNECTION_ERROR = "MULTIMIX_API_CONNECTION_ERROR";
export const MESSAGE_NOT_SUBMITTED_ERROR = "MULTIMIX_MESSAGE_NOT_SUBMITTED";
export const API_AUTH_EXPIRED_EVENT = "multimix:auth-expired";

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

type ApiError = Error & { retryable?: boolean };

function nonRetryableError(message: string): ApiError {
  const error = new Error(message) as ApiError;
  error.retryable = false;
  return error;
}

function isConnectionError(error: Error): boolean {
  return /failed to fetch|networkerror|err_failed|load failed|fetch/i.test(error.message);
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
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
    throw nonRetryableError(responseErrorMessage(body, response.statusText));
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

// ---- Backend response types (mirror ChangeIn assets API) ----
export type ContentAssetVersion = {
  id: number;
  asset_id: number;
  parent_version_id?: number | null;
  version: number;
  title: string;
  body: string;
  markdown_ref: string | null;
  artifact_ref: string | null;
  content_hash: string | null;
  instruction?: string | null;
  edit_intent?: string | null;
  diff_summary?: string | null;
  structured_payload?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ContentAsset = {
  id: number;
  project_id: number | null;
  parent_asset_id: number | null;
  library_kind?: "assets" | "copy" | "image" | "video" | string;
  asset_kind: "asset" | "copy" | "video" | "image" | "video_render" | string;
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
  created_at: string;
  updated_at: string;
  versions: ContentAssetVersion[];
};

export type AssetConversationMessageItemResponse = {
  id: number;
  role: "user" | "assistant";
  text: string;
  asset_id: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AssetConversationResponse = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  messages: AssetConversationMessageItemResponse[];
  products: ContentAsset[];
  created_at: string;
  updated_at: string;
};

export type AssetConversationSummaryResponse = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
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
  health_status: string;
  last_checked_at: string | null;
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
  visual: {
    tags?: string[];
    caption?: string;
    analysis_status?: string;
    tag_details?: Array<Record<string, unknown>>;
    objects?: string[];
  };
};

export type AssetIngestJobRead = {
  id: string;
  asset_id: number;
  status: string;
  stage: string;
  attempts: number;
  error_class: string | null;
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
  status: string;
  stage: string;
  attempts: number;
  error_message?: string | null;
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
    render_stage: string;
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

// Local auth (CHANGEIN_AUTH_PROVIDER=local). Email verification is off by default.
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

export async function getAssetLlmDiagnostics(token: string, probe = true): Promise<AssetLlmDiagnosticsRead> {
  return api<AssetLlmDiagnosticsRead>(`/assets/llm/diagnostics?probe=${probe ? "true" : "false"}`, token);
}

// Turn an arbitrary send/generation error into a user-facing Chinese message.
export function formatComposerError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return "发送失败，请稍后重试。";
  if (message === API_CONNECTION_ERROR) return "无法连接后端服务，请稍后重试。";
  if (message === MESSAGE_NOT_SUBMITTED_ERROR) return "未提交：后端没有记录这次操作，可以重试。";
  if (/[一-鿿]/.test(message)) return message;

  const lower = message.toLowerCase();
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
