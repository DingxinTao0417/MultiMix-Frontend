// Backend API client for the MultiMix unified backend (ChangeIn FastAPI base).
// Trimmed from ChangeIn frontend/lib/api.ts: keeps the assets/conversation surface
// plus a single base-URL resolution and Bearer token injection.

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export const API_BASE = CONFIGURED_API_BASE ?? "http://127.0.0.1:8199";
export const API_CONNECTION_ERROR = "MULTIMIX_API_CONNECTION_ERROR";
export const API_AUTH_EXPIRED_EVENT = "multimix:auth-expired";

// Whether a real backend is configured. When false, callers fall back to mock data.
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
    const response = await fetch(`${API_BASE}/v1${path}`, {
      method: "POST",
      body: formData,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
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
  version: number;
  title: string;
  body: string;
  markdown_ref: string | null;
  artifact_ref: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ContentAsset = {
  id: number;
  project_id: number | null;
  parent_asset_id: number | null;
  asset_kind: "asset" | "copy" | "video" | "image" | "video_render" | string;
  content_type: string;
  title: string;
  status: "processing" | "ready" | "failed" | "draft" | "archived" | string;
  source_filename: string | null;
  source_content_type: string | null;
  original_ref: string | null;
  markdown_ref: string | null;
  content_hash: string | null;
  body: string;
  metadata: Record<string, unknown>;
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

export type AssetConversationMessageResponse = {
  conversation_id: string;
  conversation: AssetConversationResponse;
  user_message: string;
  assistant_message: string;
  intent: Record<string, unknown>;
  suggestions: string[];
  product: ContentAsset | null;
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

// Turn an arbitrary send/generation error into a user-facing Chinese message.
export function formatComposerError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return "发送失败，请稍后重试。";
  if (message === API_CONNECTION_ERROR) return "无法连接后端服务，请稍后重试。";
  if (/[一-鿿]/.test(message)) return message;

  const lower = message.toLowerCase();
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
