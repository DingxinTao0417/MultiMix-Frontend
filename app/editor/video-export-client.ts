export const EXPORT_JOB_POLL_INTERVAL_MS = 2_000;
const EXPORT_JOB_MAX_CONSECUTIVE_NETWORK_ERRORS = 3;

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

export async function uploadExportCandidate(
  args: ExportClientBase & { blob: Blob },
): Promise<ExportFinalizeJob> {
  ensureNotAborted(args.signal);
  const formData = new FormData();
  formData.append("file", args.blob, "video-export.mp4");
  const response = await (args.fetchImpl ?? fetch)(
    `${args.apiBase}/v1/video/projects/${encodeURIComponent(args.assetId)}/exports`,
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
