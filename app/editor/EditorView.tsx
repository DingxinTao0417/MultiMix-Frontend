"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  disposeEditor,
  hydrateAssetFilesForExport,
  initEditorWithProject,
  updateEditorProject,
} from "@/editor-engine/vendor/bootstrap";
import type { BackendProject } from "@/editor-engine/vendor/buildProject";
import { EditorCore } from "@editor/core";
import { Timeline } from "@editor/components/editor/panels/timeline";
import { PreviewPanel } from "@editor/components/editor/panels/preview";
import {
  ExportButton,
  type ExportProgressState,
} from "@/editor-engine/vendor/ExportButton";
import { ReplacePanel } from "@/editor-engine/vendor/ReplacePanel";
import { API_BASE } from "@/editor-engine/vendor/api";
import type { BGMChoice, BGMUpdateResponse } from "@/editor-engine/vendor/api";
import { rememberRawProject, serializeBackendProject } from "@/editor-engine/vendor/serializeProject";
import { inspectEditorProject } from "@/editor-engine/vendor/quality/preflight";
import type { VideoQualityReport } from "@/app/assets/lib/video-quality";
import {
  BRAND_SHOWCASE_SPEC_VERSION,
  createBrandShowcaseFrameDecorator,
  type ExportVariant,
} from "@/lib/brand-showcase";
import { getExportMimeType } from "@editor/lib/export";
import { videoCache } from "@editor/services/video-cache/service";
import FilmStrip from "./FilmStrip";
import BgmPanel from "./BgmPanel";
import { subscribePreviewPlaybackUpdates } from "./preview-playback-sync";
import type { TimelineFlushResult } from "./timeline-save-coordinator";
import {
  clearLocalExportMarker,
  findLocalExportMarker,
  getCurrentExportJob,
  retryExportJob,
  uploadExportCandidate,
  waitForExportJob,
  writeLocalExportMarker,
  type ExportFinalizeJob,
  type ExportCandidateFormat,
  type ExportTimingEvent,
  type ExportUnitProgress,
} from "./video-export-client";

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

class ProjectSaveError extends Error {
  constructor(message: string, readonly qualityReport?: VideoQualityReport) {
    super(message);
    this.name = "ProjectSaveError";
  }
}

function qualityReportFromPayload(payload: unknown): VideoQualityReport | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.blockers) && Array.isArray(record.warnings)) {
    return record as unknown as VideoQualityReport;
  }
  if (record.quality_report && typeof record.quality_report === "object") {
    return record.quality_report as VideoQualityReport;
  }
  if (record.detail && typeof record.detail === "object") {
    return qualityReportFromPayload(record.detail);
  }
  return undefined;
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

type LoadedProject = {
  project: BackendProject;
};

type VerifiedExportHooks = {
  onStart?: () => void;
  onProgress?: (progress: ExportUnitProgress) => void;
  onPreparing?: () => void;
  onHashing?: () => void;
  onUploading?: () => void;
  onUploadProgress?: (progress: ExportUnitProgress) => void;
  onRegistering?: () => void;
  onVerifying?: () => void;
  onPublishing?: () => void;
  onQualityReport?: (report: VideoQualityReport) => void;
};

type CachedExportCandidate = {
  projectFingerprint: string;
  blob: Blob;
  format: ExportCandidateFormat;
  exportVariant: ExportVariant;
  brandSpecVersion: string | null;
  clientTimingEvents: ExportTimingEvent[];
};

const EMBED_READY_RETRY_MS = 1000;

async function refreshMountedEditorProject(project: BackendProject): Promise<void> {
  const editor = EditorCore.getInstance();
  editor.renderer.setRenderTree({ renderTree: null });
  await updateEditorProject(project);
}

async function fetchProject(endpoint: string, token: string | null): Promise<LoadedProject> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "无法加载视频项目");
  }
  const data = await res.json();
  if (data.status !== "completed" || !data.project) {
    throw new Error(`项目尚未就绪（${data.workflow_stage || data.status}）`);
  }
  const raw = data.project;
  rememberRawProject(raw);
  return {
    project: unwrapProject(raw),
  };
}

function unwrapProject(raw: Record<string, unknown>): BackendProject {
  // The unified backend format: video_project.timeline has the BackendProject shape.
  // video_orchestration format: the project itself IS the BackendProject.
  if (raw.tracks) return raw as unknown as BackendProject;
  if (raw.timeline && typeof raw.timeline === "object" && (raw.timeline as Record<string, unknown>).tracks) {
    return raw.timeline as unknown as BackendProject;
  }
  throw new Error("项目格式不兼容（缺少 tracks）");
}

async function downloadPublishedExport(
  job: ExportFinalizeJob,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!job.mp4Ref) throw new Error("已完成的成片任务缺少下载文件");
  const response = await fetch(
    `${API_BASE}/v1/video/media?ref=${encodeURIComponent(job.mp4Ref)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  );
  if (!response.ok) throw new Error(`成片下载恢复失败（HTTP ${response.status}）`);
  return response.blob();
}

function projectBgmChoice(project: BackendProject | null): BGMChoice | null {
  const choice = project?.metadata?.bgm_choice;
  return choice && typeof choice === "object" ? choice as BGMChoice : null;
}

export default function EditorView({
  jobId,
  assetId,
  token,
  refreshAccessToken,
  embed,
  mode = "edit",
  previewChannel = null,
  initialSegmentId = null,
  openMaterialPicker = false,
}: {
  jobId: string | null;
  assetId: string | null;
  token: string | null;
  refreshAccessToken?: () => Promise<string | null>;
  embed?: boolean;
  mode?: "edit" | "preview";
  previewChannel?: string | null;
  initialSegmentId?: string | null;
  openMaterialPicker?: boolean;
}) {
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadingDetail, setLoadingDetail] = useState("");
  const [isBgmPanelOpen, setIsBgmPanelOpen] = useState(false);
  const [standaloneExportState, setStandaloneExportState] = useState<ExportProgressState>({
    phase: "idle",
    progress: null,
  });
  const [activeStandaloneExportVariant, setActiveStandaloneExportVariant] = useState<ExportVariant>("original");
  const [standaloneExportBlobs, setStandaloneExportBlobs] = useState<Partial<Record<ExportVariant, Blob>>>({});
  const [standaloneExportError, setStandaloneExportError] = useState("");
  const tokenRef = useRef(token);
  const startedRef = useRef(false);
  const exportBusyRef = useRef(false);
  const readyAcknowledgedRef = useRef(false);
  const loadedProjectRef = useRef<BackendProject | null>(null);
  const candidateBlobRef = useRef<CachedExportCandidate | null>(null);
  const recoverableStandaloneExportsRef = useRef(new Map<ExportVariant, ExportFinalizeJob>());
  const activeExportAbortRef = useRef<AbortController | null>(null);
  const timelineFlushRef = useRef<(() => Promise<TimelineFlushResult>) | null>(null);
  const previewOnly = mode === "preview";

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const getExportToken = useCallback(
    () => tokenRef.current ?? token ?? "",
    [token],
  );

  const refreshExportToken = useCallback(async () => {
    const refreshed = await refreshAccessToken?.() ?? null;
    if (refreshed) tokenRef.current = refreshed;
    return refreshed;
  }, [refreshAccessToken]);

  const registerTimelineFlush = useCallback((flush: (() => Promise<TimelineFlushResult>) | null) => {
    timelineFlushRef.current = flush;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", disposeEditor);
    return () => {
      activeExportAbortRef.current?.abort();
      window.removeEventListener("pagehide", disposeEditor);
    };
  }, []);

  const postToParent = useCallback((payload: Record<string, unknown>) => {
    if (!embed || typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage(
      {
        source: "multimix-editor",
        assetId,
        previewChannel,
        ...payload,
      },
      window.location.origin
    );
  }, [assetId, embed, previewChannel]);

  const publishPreviewState = useCallback(() => {
    if (!embed || !previewOnly || state !== "ready") return;
    const editor = EditorCore.getInstance();
    postToParent({
      type: "multimix-editor-preview-state",
      time: editor.playback.getCurrentTime(),
      playing: editor.playback.getIsPlaying(),
      duration: editor.timeline.getTotalDuration(),
    });
  }, [embed, postToParent, previewOnly, state]);

  useEffect(() => {
    if (!embed || state !== "ready") return;
    readyAcknowledgedRef.current = false;
    const announceReady = () => {
      if (!readyAcknowledgedRef.current) postToParent({ type: "multimix-editor-ready" });
    };
    announceReady();
    const timer = window.setInterval(announceReady, EMBED_READY_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [embed, postToParent, state]);

  const persistCurrentProject = useCallback(async (project?: BackendProject) => {
    if (!assetId) throw new ProjectSaveError("缺少项目 ID");
    const currentToken = getExportToken();
    const body = project ?? serializeBackendProject(EditorCore.getInstance());
    const res = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null) as unknown;
    if (!res.ok) {
      throw new ProjectSaveError(
        errorMessageFromPayload(payload, `工程保存检查失败（HTTP ${res.status}）`),
        qualityReportFromPayload(payload),
      );
    }
    rememberRawProject(body as unknown as ReturnType<typeof serializeBackendProject>);
    loadedProjectRef.current = unwrapProject(body as unknown as Record<string, unknown>);
  }, [assetId, getExportToken]);

  const performVerifiedExport = useCallback(async (
    exportVariant: ExportVariant,
    hooks: VerifiedExportHooks,
  ) => {
    const preparingStartedAt = performance.now();
    hooks.onPreparing?.();
    if (assetId) writeLocalExportMarker(assetId, exportVariant, "preparing");
    const brandSpecVersion = exportVariant === "brand_showcase"
      ? BRAND_SHOWCASE_SPEC_VERSION
      : null;
    const serialized = serializeBackendProject(EditorCore.getInstance());
    const projectFingerprint = JSON.stringify(serialized);
    const currentProject = (
      Array.isArray(serialized.tracks)
        ? serialized
        : serialized.timeline && typeof serialized.timeline === "object"
          ? serialized.timeline
          : serialized
    ) as unknown as BackendProject;
    const localReport = inspectEditorProject(currentProject);
    if (localReport.blockers.length && assetId) clearLocalExportMarker(assetId, exportVariant);
    if (localReport.blockers.length) {
      hooks.onQualityReport?.(localReport);
      return null;
    }
    const currentToken = getExportToken();
    if (!assetId || !currentToken) throw new Error("缺少成片验证所需的项目身份信息");

    await persistCurrentProject(currentProject);
    const preflightResponse = await fetch(
      `${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}/quality?stage=export_preflight`,
      { headers: { Authorization: `Bearer ${currentToken}` } },
    );
    const preflightPayload = await preflightResponse.json().catch(() => null) as unknown;
    if (!preflightResponse.ok) {
      throw new Error(
        errorMessageFromPayload(
          preflightPayload,
          `导出前检查失败（HTTP ${preflightResponse.status}）`,
        ),
      );
    }
    const preflightReport = qualityReportFromPayload(preflightPayload);
    if (!preflightReport) throw new Error("导出前检查没有返回有效报告");
    if (preflightReport.blockers.length) {
      clearLocalExportMarker(assetId, exportVariant);
      hooks.onQualityReport?.(preflightReport);
      return null;
    }

    let candidate = candidateBlobRef.current?.projectFingerprint === projectFingerprint
      && candidateBlobRef.current?.exportVariant === exportVariant
      && candidateBlobRef.current?.brandSpecVersion === brandSpecVersion
      ? candidateBlobRef.current
      : null;
    if (!candidate) {
      const editor = EditorCore.getInstance();
      const currentAssets = editor.media.getAssets();
      const hydratedAssets = await hydrateAssetFilesForExport(currentAssets, currentProject);
      for (let index = 0; index < currentAssets.length; index += 1) {
        const previous = currentAssets[index];
        const hydrated = hydratedAssets[index];
        if (previous.type === "video" && previous.file.size === 0 && hydrated.file.size > 0) {
          videoCache.clearVideo({ mediaId: previous.id });
        }
      }
      editor.media.setAssets({ assets: hydratedAssets });
      const clientTimingEvents: ExportTimingEvent[] = [{
        stage: "preparing",
        source: "browser",
        status: "completed",
        duration_ms: Math.max(0, Math.round(performance.now() - preparingStartedAt)),
        attempt: 1,
      }];
      const composingStartedAt = performance.now();
      let completedFrames = 0;
      let totalFrames = 0;
      writeLocalExportMarker(assetId, exportVariant, "composing");
      hooks.onStart?.();
      const result = await editor.renderer.exportProject({
        options: {
          format: "mp4",
          quality: "high",
          includeAudio: true,
          frameDecorator: exportVariant === "brand_showcase"
            ? createBrandShowcaseFrameDecorator()
            : undefined,
        },
        onProgress: ({ progress, completedFrames: completed, totalFrames: total }) => {
          completedFrames = completed;
          totalFrames = total;
          hooks.onProgress?.({
            progress,
            completedUnits: completed,
            totalUnits: total,
            basis: "frames",
          });
        },
      });
      if (!result.success || !result.buffer) {
        throw new Error(result.error || "未知错误");
      }
      if (totalFrames <= 0 || completedFrames !== totalFrames) {
        throw new Error("成片合成没有返回完整的帧进度");
      }
      clientTimingEvents.push({
        stage: "composing",
        source: "browser",
        status: "completed",
        duration_ms: Math.max(0, Math.round(performance.now() - composingStartedAt)),
        progress_basis: "frames",
        completed_units: completedFrames,
        total_units: totalFrames,
        attempt: 1,
      });
      const format = (result.format ?? "mp4") as ExportCandidateFormat;
      const blob = new Blob([result.buffer], { type: getExportMimeType({ format }) });
      candidate = {
        projectFingerprint,
        blob,
        format,
        exportVariant,
        brandSpecVersion,
        clientTimingEvents,
      };
      candidateBlobRef.current = candidate;
    }

    const controller = new AbortController();
    activeExportAbortRef.current?.abort();
    activeExportAbortRef.current = controller;
    try {
      const exportJob = await uploadExportCandidate({
        apiBase: API_BASE,
        assetId,
        token: currentToken,
        getToken: getExportToken,
        refreshToken: refreshExportToken,
        blob: candidate.blob,
        format: candidate.format,
        exportVariant,
        brandSpecVersion,
        signal: controller.signal,
        onStage: (stage) => {
          writeLocalExportMarker(assetId, exportVariant, stage);
          if (stage === "hashing") hooks.onHashing?.();
          if (stage === "uploading") hooks.onUploading?.();
          if (stage === "registering") hooks.onRegistering?.();
        },
        onUploadProgress: hooks.onUploadProgress,
        clientTimingEvents: candidate.clientTimingEvents,
      });
      clearLocalExportMarker(assetId, exportVariant);
      const publishServerStage = (job: ExportFinalizeJob) => {
        if (job.status !== "queued" && job.status !== "running") return;
        if (job.stage === "publishing") hooks.onPublishing?.();
        else hooks.onVerifying?.();
      };
      publishServerStage(exportJob);
      const terminalJob = await waitForExportJob({
        apiBase: API_BASE,
        assetId,
        token: currentToken,
        getToken: getExportToken,
        refreshToken: refreshExportToken,
        initialJob: exportJob,
        signal: controller.signal,
        onJobUpdate: publishServerStage,
      });
      const verifiedReport = qualityReportFromPayload(terminalJob.qualityReport);
      if (terminalJob.status === "failed") {
        if (verifiedReport) hooks.onQualityReport?.(verifiedReport);
        if (!terminalJob.retryable) candidateBlobRef.current = null;
        throw new Error(terminalJob.errorMessage || "成片文件未通过完整性验证");
      }
      if (!verifiedReport) throw new Error("成片任务没有返回有效验证报告");
      if (verifiedReport.blockers.length) {
        hooks.onQualityReport?.(verifiedReport);
        candidateBlobRef.current = null;
        throw new Error("成片文件未通过完整性验证");
      }

      const confirmedToken = await refreshExportToken() || getExportToken();
      const confirmedProject = await fetchProject(
        `/v1/video/projects/${encodeURIComponent(assetId)}`,
        confirmedToken,
      );
      loadedProjectRef.current = confirmedProject.project;
      candidateBlobRef.current = null;
      return { blob: candidate.blob, report: verifiedReport, job: terminalJob };
    } finally {
      if (activeExportAbortRef.current === controller) {
        activeExportAbortRef.current = null;
      }
    }
  }, [assetId, getExportToken, persistCurrentProject, refreshExportToken]);

  const handleEmbeddedExport = useCallback(async (exportVariant: ExportVariant) => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    const brandSpecVersion = exportVariant === "brand_showcase"
      ? BRAND_SHOWCASE_SPEC_VERSION
      : null;
    const postExportUpdate = (payload: Record<string, unknown>) => postToParent({
      ...payload,
      exportVariant,
      brandSpecVersion,
    });
    try {
      const result = await performVerifiedExport(exportVariant, {
        onStart: () => postExportUpdate({ type: "multimix-editor-export-start" }),
        onProgress: ({ progress }) => postExportUpdate({
          type: "multimix-editor-export-progress",
          progress,
        }),
        onPreparing: () => postExportUpdate({ type: "multimix-editor-export-preparing" }),
        onHashing: () => postExportUpdate({ type: "multimix-editor-export-hashing" }),
        onUploading: () => postExportUpdate({ type: "multimix-editor-export-uploading" }),
        onUploadProgress: ({ progress }) => postExportUpdate({
          type: "multimix-editor-export-progress",
          progress,
        }),
        onRegistering: () => postExportUpdate({ type: "multimix-editor-export-registering" }),
        onVerifying: () => postExportUpdate({ type: "multimix-editor-export-verifying" }),
        onPublishing: () => postExportUpdate({ type: "multimix-editor-export-publishing" }),
        onQualityReport: (report) => postExportUpdate({
          type: "multimix-editor-export-quality-report",
          report,
        }),
      });
      if (result) {
        // The original click's browser activation expires during rendering and
        // verification, so the parent exposes a fresh explicit download action.
        postExportUpdate({
          type: "multimix-editor-export-success",
          report: result.report,
          blob: result.blob,
          jobId: result.job.id,
        });
      }
    } catch (cause) {
      if (cause instanceof ProjectSaveError && cause.qualityReport) {
        postExportUpdate({
          type: "multimix-editor-export-quality-report",
          report: cause.qualityReport,
        });
      }
      postExportUpdate({
        type: "multimix-editor-export-error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      exportBusyRef.current = false;
    }
  }, [performVerifiedExport, postToParent]);

  const handleStandaloneExport = useCallback(async (exportVariant: ExportVariant) => {
    setActiveStandaloneExportVariant(exportVariant);
    let recoverableJob = recoverableStandaloneExportsRef.current.get(exportVariant);
    const currentToken = getExportToken();
    if (!recoverableJob && exportVariant === "brand_showcase" && assetId && currentToken) {
      setStandaloneExportState({ phase: "verifying", progress: null });
      setStandaloneExportError("");
      try {
        const current = await getCurrentExportJob({
          apiBase: API_BASE,
          assetId,
          token: currentToken,
          getToken: getExportToken,
          refreshToken: refreshExportToken,
          exportVariant,
          brandSpecVersion: BRAND_SHOWCASE_SPEC_VERSION,
        });
        if (current?.status === "queued" || current?.status === "running") {
          setStandaloneExportState({
            phase: current.stage === "publishing" ? "publishing" : "verifying",
            progress: null,
          });
          const terminal = await waitForExportJob({
            apiBase: API_BASE,
            assetId,
            token: currentToken,
            getToken: getExportToken,
            refreshToken: refreshExportToken,
            initialJob: current,
            onJobUpdate: (job) => {
              if (job.status !== "queued" && job.status !== "running") return;
              setStandaloneExportState({
                phase: job.stage === "publishing" ? "publishing" : "verifying",
                progress: null,
              });
            },
          });
          if (terminal.status === "completed") {
            const downloadToken = await refreshExportToken() || getExportToken();
            const blob = await downloadPublishedExport(terminal, downloadToken);
            setStandaloneExportBlobs((previous) => ({ ...previous, [exportVariant]: blob }));
            setStandaloneExportState({ phase: "completed", progress: 1 });
            return;
          }
          recoverableJob = terminal.retryable ? terminal : undefined;
        } else if (current?.status === "completed") {
          const downloadToken = await refreshExportToken() || getExportToken();
          const blob = await downloadPublishedExport(current, downloadToken);
          setStandaloneExportBlobs((previous) => ({ ...previous, [exportVariant]: blob }));
          setStandaloneExportState({ phase: "completed", progress: 1 });
          return;
        } else if (current?.retryable) {
          recoverableJob = current;
        }
      } catch (cause) {
        setStandaloneExportState({ phase: "error", progress: null });
        setStandaloneExportError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    if (recoverableJob?.retryable && assetId && currentToken) {
      setStandaloneExportState({ phase: "verifying", progress: null });
      setStandaloneExportError("");
      try {
        const retried = await retryExportJob({
          apiBase: API_BASE,
          assetId,
          jobId: recoverableJob.id,
          token: currentToken,
          getToken: getExportToken,
          refreshToken: refreshExportToken,
        });
        const terminal = await waitForExportJob({
          apiBase: API_BASE,
          assetId,
          token: currentToken,
          getToken: getExportToken,
          refreshToken: refreshExportToken,
          initialJob: retried,
          onJobUpdate: (job) => {
            if (job.status !== "queued" && job.status !== "running") return;
            setStandaloneExportState({
              phase: job.stage === "publishing" ? "publishing" : "verifying",
              progress: null,
            });
          },
        });
        if (terminal.status === "failed") {
          if (terminal.retryable) recoverableStandaloneExportsRef.current.set(exportVariant, terminal);
          else recoverableStandaloneExportsRef.current.delete(exportVariant);
          throw new Error(terminal.errorMessage || "成片检查未完成");
        }
        recoverableStandaloneExportsRef.current.delete(exportVariant);
        const downloadToken = await refreshExportToken() || getExportToken();
        const blob = await downloadPublishedExport(terminal, downloadToken);
        setStandaloneExportBlobs((previous) => ({ ...previous, [exportVariant]: blob }));
        setStandaloneExportState({ phase: "completed", progress: 1 });
      } catch (cause) {
        setStandaloneExportState({ phase: "error", progress: null });
        setStandaloneExportError(cause instanceof Error ? cause.message : String(cause));
      }
      return;
    }
    recoverableStandaloneExportsRef.current.delete(exportVariant);
    let blockerMessage = "";
    setStandaloneExportError("");
    setStandaloneExportBlobs((previous) => {
      const next = { ...previous };
      delete next[exportVariant];
      return next;
    });
    try {
      const result = await performVerifiedExport(exportVariant, {
        onPreparing: () => setStandaloneExportState({ phase: "preparing", progress: null }),
        onStart: () => setStandaloneExportState({ phase: "rendering", progress: null }),
        onProgress: ({ progress }) => setStandaloneExportState({ phase: "rendering", progress }),
        onHashing: () => setStandaloneExportState({ phase: "hashing", progress: null }),
        onUploading: () => setStandaloneExportState({ phase: "uploading", progress: null }),
        onUploadProgress: ({ progress }) => setStandaloneExportState({ phase: "uploading", progress }),
        onRegistering: () => setStandaloneExportState({ phase: "registering", progress: null }),
        onVerifying: () => setStandaloneExportState({ phase: "verifying", progress: null }),
        onPublishing: () => setStandaloneExportState({ phase: "publishing", progress: null }),
        onQualityReport: (report) => {
          blockerMessage = report.blockers[0]?.message || "当前工程未通过导出检查";
        },
      });
      if (!result && blockerMessage) throw new Error(blockerMessage);
      if (result) {
        setStandaloneExportBlobs((previous) => ({ ...previous, [exportVariant]: result.blob }));
        setStandaloneExportState({ phase: "completed", progress: 1 });
      } else {
        setStandaloneExportState({ phase: "idle", progress: null });
      }
    } catch (cause) {
      setStandaloneExportState({ phase: "error", progress: null });
      setStandaloneExportError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [assetId, getExportToken, performVerifiedExport, refreshExportToken]);

  const handleBgmProjectChanged = useCallback(async (result: BGMUpdateResponse) => {
    candidateBlobRef.current = null;
    recoverableStandaloneExportsRef.current.clear();
    setStandaloneExportBlobs({});
    rememberRawProject(result.project);
    const project = unwrapProject(result.project);
    loadedProjectRef.current = project;
    await refreshMountedEditorProject(project);
    postToParent({ type: "multimix-editor-project-updated", reason: "bgm" });
  }, [postToParent]);

  const handleSave = async () => {
    if (!assetId || saveState === "saving") return;
    setSaveState("saving");
    try {
      await persistCurrentProject();
      candidateBlobRef.current = null;
      recoverableStandaloneExportsRef.current.clear();
      setStandaloneExportBlobs({});
      postToParent({ type: "multimix-editor-project-updated", reason: "timeline" });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 4000);
    }
  };

  useEffect(() => {
    const endpoint = jobId
      ? `/v1/video/jobs/${encodeURIComponent(jobId)}`
      : assetId
        ? `/v1/video/projects/${encodeURIComponent(assetId)}`
        : null;
    console.log("[Editor] load:", { jobId, assetId, token: token ? "set" : "null", endpoint, API_BASE });
    if (!endpoint) {
      setState("error");
      setError("缺少项目 ID。请从对话中生成视频后再打开剪辑器。");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    setState("loading");
    void (async () => {
      try {
        const loadedProject = await fetchProject(endpoint, getExportToken());
        candidateBlobRef.current = null;
        recoverableStandaloneExportsRef.current.clear();
        setStandaloneExportBlobs({});
        loadedProjectRef.current = loadedProject.project;
        await initEditorWithProject(loadedProject.project, (loaded, total) => {
          setLoadingDetail(total > 0 ? `正在下载素材 ${loaded}/${total}` : "");
        });
        setState("ready");
        postToParent({ type: "multimix-editor-ready" });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
        postToParent({
          type: "multimix-editor-error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [jobId, assetId, getExportToken, postToParent, token]);

  useEffect(() => {
    const currentToken = getExportToken();
    if (embed || state !== "ready" || !assetId || !currentToken) return;
    const controller = new AbortController();
    const localExportAtStart = findLocalExportMarker(assetId);
    void (async () => {
      try {
        const current = await getCurrentExportJob({
          apiBase: API_BASE,
          assetId,
          token: currentToken,
          getToken: getExportToken,
          refreshToken: refreshExportToken,
          exportVariant: "original",
          signal: controller.signal,
        });
        const localExportNow = findLocalExportMarker(assetId);
        if (
          localExportNow?.exportVariant !== localExportAtStart?.exportVariant
          || localExportNow?.marker.stage !== localExportAtStart?.marker.stage
          || localExportNow?.marker.startedAt !== localExportAtStart?.marker.startedAt
        ) return;
        if (!current) {
          if (localExportAtStart) {
            setActiveStandaloneExportVariant(localExportAtStart.exportVariant);
            setStandaloneExportState({ phase: "error", progress: null });
            setStandaloneExportError("上次导出在浏览器本地阶段中断，无法自动恢复，请重新导出。");
          }
          return;
        }
        clearLocalExportMarker(assetId, "original");
        let terminal: ExportFinalizeJob = current;
        if (current.status === "queued" || current.status === "running") {
          setStandaloneExportState({
            phase: current.stage === "publishing" ? "publishing" : "verifying",
            progress: null,
          });
          terminal = await waitForExportJob({
            apiBase: API_BASE,
            assetId,
            token: currentToken,
            getToken: getExportToken,
            refreshToken: refreshExportToken,
            initialJob: current,
            signal: controller.signal,
            onJobUpdate: (job) => {
              if (job.status !== "queued" && job.status !== "running") return;
              setStandaloneExportState({
                phase: job.stage === "publishing" ? "publishing" : "verifying",
                progress: null,
              });
            },
          });
        }
        if (terminal.status === "failed") {
          if (terminal.retryable) recoverableStandaloneExportsRef.current.set("original", terminal);
          else recoverableStandaloneExportsRef.current.delete("original");
          setStandaloneExportState({ phase: "error", progress: null });
          setStandaloneExportError(terminal.errorMessage || "成片检查未完成");
          return;
        }
        recoverableStandaloneExportsRef.current.delete("original");
        const downloadToken = await refreshExportToken() || getExportToken();
        const blob = await downloadPublishedExport(terminal, downloadToken, controller.signal);
        setStandaloneExportBlobs((previous) => ({ ...previous, original: blob }));
        setStandaloneExportState({ phase: "completed", progress: 1 });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setStandaloneExportState({ phase: "error", progress: null });
        setStandaloneExportError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => controller.abort();
  }, [assetId, embed, getExportToken, refreshExportToken, state]);

  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if ((data as { source?: string }).source !== "multimix-workspace") return;
      const message = data as {
        type?: string;
        time?: number;
        requestId?: string;
        exportVariant?: unknown;
      };
      const exportVariant: ExportVariant = message.exportVariant === "brand_showcase"
        ? "brand_showcase"
        : "original";
      if (message.type === "multimix-editor-ready-ack") {
        readyAcknowledgedRef.current = true;
        return;
      }
      if (message.type === "multimix-editor-bgm-open") {
        if (!previewOnly && state === "ready") setIsBgmPanelOpen(true);
        return;
      }
      const syncRequested = message.type === "multimix-editor-sync"
        || (previewOnly && message.type === "multimix-editor-preview-sync");
      if (syncRequested) {
        if (state === "ready") {
          postToParent({ type: "multimix-editor-ready" });
          if (previewOnly) publishPreviewState();
        }
        return;
      }
      if (message.type === "multimix-editor-flush") {
        const requestId = message.requestId;
        if (!requestId || previewOnly || state !== "ready" || !timelineFlushRef.current) {
          postToParent({
            type: "multimix-editor-flush-result",
            requestId,
            status: "error",
            message: "剪辑器尚未准备好保存时间线，请稍后重试。",
          });
          return;
        }
        void timelineFlushRef.current().then((result) => {
          postToParent({
            type: "multimix-editor-flush-result",
            requestId,
            ...result,
          });
        });
        return;
      }
      if (state !== "ready") {
        if (message.type === "multimix-editor-export") {
          postToParent({
            type: "multimix-editor-export-error",
            message: "剪辑器尚未准备完成",
            exportVariant,
          });
        }
        return;
      }
      const editor = EditorCore.getInstance();
      if (message.type === "multimix-editor-export") {
        void handleEmbeddedExport(exportVariant);
      } else if (previewOnly && message.type === "multimix-editor-preview-seek" && typeof message.time === "number") {
        editor.playback.seek({ time: message.time });
      } else if (previewOnly && message.type === "multimix-editor-preview-toggle") {
        editor.playback.toggle();
      } else if (previewOnly && message.type === "multimix-editor-preview-play") {
        editor.playback.play();
      } else if (previewOnly && message.type === "multimix-editor-preview-pause") {
        editor.playback.pause();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    embed,
    state,
    handleEmbeddedExport,
    postToParent,
    publishPreviewState,
    previewOnly,
  ]);

  useEffect(() => {
    if (!embed || !previewOnly || state !== "ready") return;
    const editor = EditorCore.getInstance();
    const unsubscribe = editor.playback.subscribe(publishPreviewState);
    const unsubscribePlaybackUpdates = subscribePreviewPlaybackUpdates({
      publish: publishPreviewState,
    });
    publishPreviewState();
    return () => {
      unsubscribe();
      unsubscribePlaybackUpdates();
    };
  }, [embed, previewOnly, publishPreviewState, state]);

  return (
    <div className={`editor-root${previewOnly ? " preview-only" : ""}`}>
      {!embed ? (
        <div className="editor-actionbar">
          <a href="/app/assets" className="editor-backlink">← 工作台</a>

          <div className="editor-actionbar-status" aria-live="polite">
            {state === "loading" ? <span>{loadingDetail || "正在加载项目…"}</span> : null}
            {state === "error" ? <span className="error">{error}</span> : null}
          </div>

          <div className="editor-actionbar-actions">
            {state === "ready" && assetId ? (
              <button
                onClick={handleSave}
                disabled={saveState === "saving"}
                className={`editor-action-pill${saveState === "error" ? " danger" : saveState === "saved" ? " success" : " primary"}`}
              >
                {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败，点击重试" : "保存项目"}
              </button>
            ) : null}
            {state === "ready" ? (
              <ExportButton
                onExport={handleStandaloneExport}
                exportState={standaloneExportState}
                activeExportVariant={activeStandaloneExportVariant}
                verifiedBlobs={standaloneExportBlobs}
                errorText={standaloneExportError}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {state === "ready" ? (
        previewOnly ? (
          <div className="editor-preview-only">
            <PreviewPanel bare />
          </div>
        ) : (
          <div className="editor-layout">
            <div className="editor-preview-region">
              <PreviewPanel />
              <ReplacePanel assetId={assetId} token={token} />
              {assetId ? (
                <BgmPanel
                  assetId={assetId}
                  token={token}
                  initialChoice={projectBgmChoice(loadedProjectRef.current)}
                  open={isBgmPanelOpen}
                  onOpenChange={setIsBgmPanelOpen}
                  onPrepareChange={persistCurrentProject}
                  onProjectChanged={handleBgmProjectChanged}
                />
              ) : null}
            </div>
            <div className="editor-timeline-region">
              {embed ? (
                // Spec §5.5: the embed edit form is the film strip; the
                // multi-track timeline stays a full-screen /editor capability.
                <FilmStrip
                  assetId={assetId}
                  token={token}
                  initialSegmentId={initialSegmentId}
                  openMaterialPicker={openMaterialPicker}
                  onFlushReady={registerTimelineFlush}
                />
              ) : (
                <Timeline />
              )}
            </div>
          </div>
        )
      ) : (
        <div className="editor-loading-shell">
          {state === "error" ? error : loadingDetail || "正在准备剪辑器…"}
        </div>
      )}
    </div>
  );
}
