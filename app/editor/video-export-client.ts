import { Upload } from "tus-js-client";

export const EXPORT_JOB_POLL_INTERVAL_MS = 2_000;
const EXPORT_JOB_MAX_CONSECUTIVE_NETWORK_ERRORS = 3;
const SUPABASE_TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;
const SUPABASE_TUS_RETRY_DELAYS_MS = [0, 3_000, 5_000, 10_000, 20_000];

export type ExportFinalizeJob = {
  id: string;
  assetId: number;
  status: "queued" | "running" | "completed" | "failed";
  stage: "uploaded" | "verifying" | "publishing" | "done" | "failed";
  retryable: boolean;
  errorMessage: string | null;
  qualityReport: Record<string, unknown> | null;
  mp4Ref: string | null;
};

type ExportClientBase = {
  apiBase: string;
  assetId: string;
  token: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type ExportCandidateStage = "hashing" | "uploading" | "registering";
export type ExportCandidateFormat = "mp4" | "webm";

type ExportUploadSession = {
  mode: "direct" | "multipart";
  uploadUrl: string;
  uploadMethod: "PUT" | "POST";
  projectFingerprint: string;
};

type ResumableUploadOptions = {
  endpoint: string;
  fingerprint: () => Promise<string>;
  retryDelays: number[];
  headers: Record<string, string>;
  uploadDataDuringCreation: boolean;
  removeFingerprintOnSuccess: boolean;
  storeFingerprintForResuming: boolean;
  metadata: Record<string, string>;
  chunkSize: number;
  onSuccess: () => void;
  onError: (error: Error) => void;
};

type PreviousResumableUpload = Parameters<Upload["resumeFromPreviousUpload"]>[0];

type ResumableUploadHandle = {
  abort: () => Promise<void>;
  findPreviousUploads: () => Promise<PreviousResumableUpload[]>;
  resumeFromPreviousUpload: (previousUpload: PreviousResumableUpload) => void;
  start: () => void;
};

type ResumableUploadFactory = (
  blob: Blob,
  options: ResumableUploadOptions,
) => ResumableUploadHandle;

type SupabaseSignedResumableTarget = {
  endpoint: string;
  token: string;
  bucketName: string;
  objectName: string;
};

type WireExportFinalizeJob = {
  job_id?: unknown;
  asset_id?: unknown;
  status?: unknown;
  stage?: unknown;
  retryable?: unknown;
  error_message?: unknown;
  quality_report?: unknown;
  mp4_ref?: unknown;
};

export class ExportJobHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ExportJobHttpError";
  }
}

function abortError(): DOMException {
  return new DOMException("Export job polling was aborted.", "AbortError");
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function parseExportJob(payload: unknown): ExportFinalizeJob {
  if (!payload || typeof payload !== "object") {
    throw new Error("成片任务返回了无效数据");
  }
  const wire = payload as WireExportFinalizeJob;
  const statuses = new Set(["queued", "running", "completed", "failed"]);
  const stages = new Set(["uploaded", "verifying", "publishing", "done", "failed"]);
  if (
    typeof wire.job_id !== "string"
    || typeof wire.asset_id !== "number"
    || typeof wire.status !== "string"
    || !statuses.has(wire.status)
    || typeof wire.stage !== "string"
    || !stages.has(wire.stage)
  ) {
    throw new Error("成片任务返回了无效状态");
  }
  return {
    id: wire.job_id,
    assetId: wire.asset_id,
    status: wire.status as ExportFinalizeJob["status"],
    stage: wire.stage as ExportFinalizeJob["stage"],
    retryable: wire.retryable === true,
    errorMessage: typeof wire.error_message === "string" ? wire.error_message : null,
    qualityReport: wire.quality_report && typeof wire.quality_report === "object"
      ? wire.quality_report as Record<string, unknown>
      : null,
    mp4Ref: typeof wire.mp4_ref === "string" ? wire.mp4_ref : null,
  };
}

async function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  if (record.detail && typeof record.detail === "object") {
    const message = (record.detail as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

async function requireJob(response: Response, fallback: string): Promise<ExportFinalizeJob> {
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new ExportJobHttpError(
      errorMessage(payload, `${fallback}（HTTP ${response.status}）`),
      response.status,
      payload,
    );
  }
  return parseExportJob(payload);
}

function isRetryableResponse(response: Response): boolean {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

async function fetchWithOneRetry(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(input, init);
      if (!isRetryableResponse(response) || attempt === 1) return response;
    } catch (cause) {
      lastError = cause;
      if (attempt === 1) throw cause;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("网络请求失败");
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseUploadSession(payload: unknown): ExportUploadSession {
  if (!payload || typeof payload !== "object") throw new Error("成片上传会话返回了无效数据");
  const wire = payload as Record<string, unknown>;
  if (
    (wire.mode !== "direct" && wire.mode !== "multipart")
    || typeof wire.upload_url !== "string"
    || (wire.upload_method !== "PUT" && wire.upload_method !== "POST")
    || typeof wire.project_fingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(wire.project_fingerprint)
  ) {
    throw new Error("成片上传会话返回了无效状态");
  }
  return {
    mode: wire.mode,
    uploadUrl: wire.upload_url,
    uploadMethod: wire.upload_method,
    projectFingerprint: wire.project_fingerprint,
  };
}

function parseSupabaseSignedResumableTarget(uploadUrl: string): SupabaseSignedResumableTarget {
  const url = new URL(uploadUrl);
  const marker = "/storage/v1/object/upload/sign/";
  const markerIndex = url.pathname.indexOf(marker);
  const encodedPath = markerIndex >= 0
    ? url.pathname.slice(markerIndex + marker.length)
    : "";
  const pathParts = encodedPath.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const token = url.searchParams.get("token") ?? "";
  const [bucketName, ...objectParts] = pathParts;
  const objectName = objectParts.join("/");
  if (!bucketName || !objectName || !token || !/^https?:$/.test(url.protocol)) {
    throw new Error("成片上传会话未返回有效的大文件上传地址");
  }

  const endpointUrl = new URL(url.origin);
  if (!endpointUrl.hostname.includes(".storage.supabase.")) {
    endpointUrl.hostname = endpointUrl.hostname.replace(
      /\.supabase\.(co|in|red)$/,
      ".storage.supabase.$1",
    );
  }
  endpointUrl.pathname = "/storage/v1/upload/resumable/sign";
  return {
    endpoint: endpointUrl.toString(),
    token,
    bucketName,
    objectName,
  };
}

async function uploadDirectCandidateResumably(
  args: {
    blob: Blob;
    format: ExportCandidateFormat;
    sha256: string;
    uploadUrl: string;
    signal?: AbortSignal;
    resumableUploadFactory?: ResumableUploadFactory;
  },
): Promise<void> {
  ensureNotAborted(args.signal);
  const target = parseSupabaseSignedResumableTarget(args.uploadUrl);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      args.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      void upload.abort().catch(() => undefined).finally(() => {
        finish(() => reject(abortError()));
      });
    };
    const factory = args.resumableUploadFactory
      ?? ((blob, options) => new Upload(blob, options) as ResumableUploadHandle);
    const upload = factory(args.blob, {
      endpoint: target.endpoint,
      fingerprint: async () => [
        "multimix-video-export",
        target.bucketName,
        target.objectName,
        args.sha256,
      ].join(":"),
      retryDelays: SUPABASE_TUS_RETRY_DELAYS_MS,
      headers: {
        "x-signature": target.token,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      metadata: {
        bucketName: target.bucketName,
        objectName: target.objectName,
        contentType: args.blob.type || `video/${args.format}`,
        cacheControl: "3600",
      },
      chunkSize: SUPABASE_TUS_CHUNK_SIZE_BYTES,
      onSuccess: () => finish(resolve),
      onError: (error) => finish(() => reject(error)),
    });
    args.signal?.addEventListener("abort", onAbort, { once: true });
    if (args.signal?.aborted) {
      onAbort();
      return;
    }
    void upload.findPreviousUploads()
      .then((previousUploads) => {
        if (settled) return;
        if (previousUploads[0]) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch((error: unknown) => {
        finish(() => reject(error));
      });
  });
}

async function createUploadSession(
  args: ExportClientBase & { sha256: string; sizeBytes: number; format: ExportCandidateFormat },
): Promise<ExportUploadSession> {
  const response = await (args.fetchImpl ?? fetch)(
    `${args.apiBase}/v1/video/projects/${encodeURIComponent(args.assetId)}/exports/uploads`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sha256: args.sha256,
        size_bytes: args.sizeBytes,
        format: args.format,
      }),
      signal: args.signal,
    },
  );
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new ExportJobHttpError(
      errorMessage(payload, `无法创建成片上传会话（HTTP ${response.status}）`),
      response.status,
      payload,
    );
  }
  return parseUploadSession(payload);
}

export async function uploadExportCandidate(
  args: ExportClientBase & {
    blob: Blob;
    format?: ExportCandidateFormat;
    onStage?: (stage: ExportCandidateStage) => void;
    resumableUploadFactory?: ResumableUploadFactory;
  },
): Promise<ExportFinalizeJob> {
  ensureNotAborted(args.signal);
  const format = args.format ?? "mp4";
  args.onStage?.("hashing");
  const sha256 = await sha256Hex(args.blob);
  ensureNotAborted(args.signal);
  const session = await createUploadSession({
    ...args,
      sha256,
      sizeBytes: args.blob.size,
      format,
  });

  args.onStage?.("uploading");
  if (session.mode === "direct") {
    await uploadDirectCandidateResumably({
      blob: args.blob,
      format,
      sha256,
      uploadUrl: session.uploadUrl,
      signal: args.signal,
      resumableUploadFactory: args.resumableUploadFactory,
    });
    args.onStage?.("registering");
    const registerResponse = await fetchWithOneRetry(
      args.fetchImpl ?? fetch,
      `${args.apiBase}/v1/video/projects/${encodeURIComponent(args.assetId)}/exports/register`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sha256,
          size_bytes: args.blob.size,
          format,
          project_fingerprint: session.projectFingerprint,
        }),
        signal: args.signal,
      },
    );
    return requireJob(registerResponse, "成片登记失败");
  }

  const formData = new FormData();
  formData.append("file", args.blob, `video-export.${format}`);
  const response = await (args.fetchImpl ?? fetch)(
    new URL(session.uploadUrl, `${args.apiBase}/`).toString(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}` },
      body: formData,
      signal: args.signal,
    },
  );
  return requireJob(response, "成片上传失败");
}

export async function getCurrentExportJob(
  args: ExportClientBase,
): Promise<ExportFinalizeJob | null> {
  ensureNotAborted(args.signal);
  const response = await (args.fetchImpl ?? fetch)(
    `${args.apiBase}/v1/video/projects/${encodeURIComponent(args.assetId)}/exports/current`,
    {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: args.signal,
    },
  );
  if (response.status === 404) return null;
  return requireJob(response, "无法恢复成片任务");
}

export async function getExportJob(
  args: ExportClientBase & { jobId: string },
): Promise<ExportFinalizeJob> {
  ensureNotAborted(args.signal);
  const response = await (args.fetchImpl ?? fetch)(
    `${args.apiBase}/v1/video/projects/${encodeURIComponent(args.assetId)}`
      + `/exports/${encodeURIComponent(args.jobId)}`,
    {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: args.signal,
    },
  );
  return requireJob(response, "无法读取成片任务");
}

export async function retryExportJob(
  args: ExportClientBase & { jobId: string },
): Promise<ExportFinalizeJob> {
  ensureNotAborted(args.signal);
  const response = await (args.fetchImpl ?? fetch)(
    `${args.apiBase}/v1/video/jobs/${encodeURIComponent(args.jobId)}/retry`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}` },
      signal: args.signal,
    },
  );
  if (!response.ok) {
    const payload = await responsePayload(response);
    throw new ExportJobHttpError(
      errorMessage(payload, `无法重试成片任务（HTTP ${response.status}）`),
      response.status,
      payload,
    );
  }
  return getExportJob(args);
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  ensureNotAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

export async function waitForExportJob(
  args: ExportClientBase & {
    initialJob: ExportFinalizeJob;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<ExportFinalizeJob> {
  let current = args.initialJob;
  let consecutiveNetworkErrors = 0;
  const sleep = args.sleep ?? defaultSleep;
  while (current.status !== "completed" && current.status !== "failed") {
    ensureNotAborted(args.signal);
    await sleep(EXPORT_JOB_POLL_INTERVAL_MS, args.signal);
    try {
      current = await getExportJob({
        ...args,
        jobId: current.id,
      });
      consecutiveNetworkErrors = 0;
    } catch (cause) {
      ensureNotAborted(args.signal);
      if (cause instanceof ExportJobHttpError) throw cause;
      consecutiveNetworkErrors += 1;
      if (consecutiveNetworkErrors >= EXPORT_JOB_MAX_CONSECUTIVE_NETWORK_ERRORS) throw cause;
    }
  }
  return current;
}
