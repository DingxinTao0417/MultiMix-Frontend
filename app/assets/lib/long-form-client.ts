import {
  API_AUTH_EXPIRED_EVENT,
  API_BASE,
  API_CONNECTION_ERROR,
  api,
} from "../../../lib/api";
import { isRecord, stringValue } from "./asset-workspace-shared";

export type LongFormChapter = {
  id: string;
  start_seconds: number;
  end_seconds: number;
  title: string;
  summary: string;
};

export type LongFormCandidate = {
  id: string;
  title: string;
  why_publish: string;
  source_start_seconds: number;
  source_end_seconds: number;
  target_seconds: number;
  core_quote: string;
  recommended_ratio: "9:16" | "16:9" | "1:1" | "source";
  visual_completeness: "complete" | "incomplete";
  grounded: boolean;
};

export type LongFormAnalysis = {
  schema_version: "long_form_candidate_set:v1";
  source_asset_id: number;
  chapters: LongFormChapter[];
  top_candidate_ids: string[];
  candidates: LongFormCandidate[];
};

export type LongFormCandidateContext = {
  analysis: LongFormAnalysis;
  sourcePlaybackUrl: string;
};

export type LongFormSelectAction = {
  kind: "select";
  analysisAssetId: number;
  candidateId: string;
};

export type LongFormSourceAction =
  | LongFormSelectAction
  | { kind: "preserve"; analysisAssetId: number };

type LongFormPlaybackResponse = {
  playback_url: string;
  expires_in_seconds: number;
};

export type LongFormSourceReady = {
  id: number;
  title: string;
};

export type LongFormSourceImport = {
  asset_id: number;
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  source_kind: "youtube" | "bilibili" | "direct_mp4";
};

export type LongFormIngestJob = {
  id: string;
  asset_id: number;
  status: "queued" | "running" | "completed" | "failed";
  error_message: string | null;
};

const LONG_FORM_INGEST_POLL_INTERVAL_MS = 1_500;

function requestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function responseError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.detail === "string") return payload.detail;
  return fallback || "请求失败，请稍后重试。";
}

export function uploadLongFormSource(
  token: string,
  file: File,
  onProgress: (percent: number | null) => void,
): Promise<LongFormSourceReady> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE}/v1/long-form/sources/upload`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("Idempotency-Key", requestId());
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable && event.total > 0
        ? Math.min(99, Math.round((event.loaded / event.total) * 100))
        : null);
    };
    request.onerror = () => reject(new Error(API_CONNECTION_ERROR));
    request.onload = () => {
      let payload: unknown;
      try {
        payload = request.responseText ? JSON.parse(request.responseText) as unknown : undefined;
      } catch {
        payload = undefined;
      }
      if (request.status >= 200 && request.status < 300 && isRecord(payload)) {
        const id = payload.id;
        const title = stringValue(payload.title);
        if (typeof id === "number" && Number.isInteger(id) && id > 0 && title) {
          onProgress(100);
          resolve({ id, title });
          return;
        }
      }
      if (request.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(API_AUTH_EXPIRED_EVENT));
      }
      reject(new Error(responseError(payload, request.statusText)));
    };
    const formData = new FormData();
    formData.append("file", file);
    request.send(formData);
  });
}

export async function importLongFormSourceUrl(
  token: string,
  sourceUrl: string,
): Promise<LongFormSourceImport> {
  return api<LongFormSourceImport>("/long-form/sources/url", token, {
    method: "POST",
    headers: { "Idempotency-Key": requestId() },
    body: JSON.stringify({ url: sourceUrl }),
  });
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeoutId = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export async function waitForLongFormSourceReady(
  token: string,
  assetId: number,
  signal: AbortSignal,
): Promise<LongFormIngestJob> {
  while (!signal.aborted) {
    const job = await api<LongFormIngestJob>(
      `/assets/${assetId}/ingest-jobs/latest`,
      token,
      { signal },
    );
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new Error(job.error_message || "视频链接解析失败，请检查链接后重试。");
    }
    await abortableDelay(LONG_FORM_INGEST_POLL_INTERVAL_MS, signal);
  }
  throw new DOMException("Aborted", "AbortError");
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseCandidate(value: unknown): LongFormCandidate | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  if (!id || !title) return null;
  const ratio = stringValue(value.recommended_ratio);
  const completeness = stringValue(value.visual_completeness);
  return {
    id,
    title,
    why_publish: stringValue(value.why_publish),
    source_start_seconds: finiteNumber(value.source_start_seconds),
    source_end_seconds: finiteNumber(value.source_end_seconds),
    target_seconds: finiteNumber(value.target_seconds),
    core_quote: stringValue(value.core_quote),
    recommended_ratio: (["9:16", "16:9", "1:1", "source"].includes(ratio) ? ratio : "source") as LongFormCandidate["recommended_ratio"],
    visual_completeness: completeness === "complete" ? "complete" : "incomplete",
    grounded: value.grounded !== false,
  };
}

function parseChapter(value: unknown): LongFormChapter | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    summary: stringValue(value.summary),
    start_seconds: finiteNumber(value.start_seconds),
    end_seconds: finiteNumber(value.end_seconds),
  };
}

export function longFormAnalysisFromMetadata(metadata: Record<string, unknown>): LongFormAnalysis | null {
  const full = isRecord(metadata.long_form_analysis) ? metadata.long_form_analysis : metadata;
  const sourceAssetId = finiteNumber(full.source_asset_id || metadata.source_asset_id);
  const rawCandidates = Array.isArray(full.candidates)
    ? full.candidates
    : Array.isArray(metadata.top_candidates) ? metadata.top_candidates : [];
  const candidates = rawCandidates
    .map(parseCandidate)
    .filter((item): item is LongFormCandidate => item !== null);
  const rawTopIds = Array.isArray(full.top_candidate_ids)
    ? full.top_candidate_ids
    : Array.isArray(metadata.top_candidate_ids) ? metadata.top_candidate_ids : [];
  const topIds = rawTopIds.length
    ? rawTopIds.map(stringValue).filter(Boolean)
    : candidates.map((candidate) => candidate.id);
  const chapters = (Array.isArray(full.chapters) ? full.chapters : [])
    .map(parseChapter)
    .filter((item): item is LongFormChapter => item !== null);
  if (!sourceAssetId || (!candidates.length && !chapters.length)) return null;
  return {
    schema_version: "long_form_candidate_set:v1",
    source_asset_id: sourceAssetId,
    chapters,
    top_candidate_ids: topIds,
    candidates,
  };
}

export async function getLongFormCandidateContext(
  token: string,
  analysisAssetId: number,
): Promise<LongFormCandidateContext> {
  const rawAnalysis = await api<Record<string, unknown>>(
    `/long-form/analyses/${analysisAssetId}`,
    token,
  );
  const analysis = longFormAnalysisFromMetadata(rawAnalysis);
  if (!analysis) throw new Error("长视频拆条分析结果不完整，请重试分析。");
  const playback = await api<LongFormPlaybackResponse>(
    `/long-form/sources/${analysis.source_asset_id}/playback`,
    token,
  );
  if (!playback.playback_url) throw new Error("原片预览地址不可用，请稍后重试。");
  return {
    analysis,
    sourcePlaybackUrl: new URL(playback.playback_url, API_BASE).toString(),
  };
}

export function parseLongFormActionEvent(event: Event): LongFormSourceAction | null {
  if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return null;
  const analysisAssetId = event.detail.analysisAssetId;
  if (typeof analysisAssetId !== "number"
    || !Number.isInteger(analysisAssetId)
    || analysisAssetId <= 0
  ) return null;
  if (event.detail.kind === "preserve") {
    return { kind: "preserve", analysisAssetId };
  }
  const candidateId = stringValue(event.detail.candidateId);
  if (event.detail.kind !== "select" || !candidateId) return null;
  return { kind: "select", analysisAssetId, candidateId };
}
