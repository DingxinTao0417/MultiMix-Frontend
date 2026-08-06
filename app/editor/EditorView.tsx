"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  disposeEditor,
  initEditorWithProject,
  updateEditorProject,
} from "@/editor-engine/vendor/bootstrap";
import type { BackendProject } from "@/editor-engine/vendor/buildProject";
import { EditorCore } from "@editor/core";
import { Timeline } from "@editor/components/editor/panels/timeline";
import { PreviewPanel } from "@editor/components/editor/panels/preview";
import { ExportButton } from "@/editor-engine/vendor/ExportButton";
import { ReplacePanel } from "@/editor-engine/vendor/ReplacePanel";
import { API_BASE } from "@/editor-engine/vendor/api";
import type { BGMChoice, BGMUpdateResponse } from "@/editor-engine/vendor/api";
import { rememberRawProject, serializeBackendProject } from "@/editor-engine/vendor/serializeProject";
import { inspectEditorProject } from "@/editor-engine/vendor/quality/preflight";
import type { VideoQualityReport } from "@/app/assets/lib/video-quality";
import { getExportMimeType } from "@editor/lib/export";
import FilmStrip from "./FilmStrip";
import BgmPanel from "./BgmPanel";

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

type LoadedProject = {
  project: BackendProject;
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
    throw new Error(`项目尚未就绪（${data.status} / ${data.render_stage}）`);
  }
  const raw = data.project;
  rememberRawProject(raw);
  return {
    project: unwrapProject(raw),
  };
}

function unwrapProject(raw: Record<string, unknown>): BackendProject {
  // ChangeIn format: video_project.timeline has the BackendProject shape.
  // video_orchestration format: the project itself IS the BackendProject.
  if (raw.tracks) return raw as unknown as BackendProject;
  if (raw.timeline && typeof raw.timeline === "object" && (raw.timeline as Record<string, unknown>).tracks) {
    return raw.timeline as unknown as BackendProject;
  }
  throw new Error("项目格式不兼容（缺少 tracks）");
}

function projectBgmChoice(project: BackendProject | null): BGMChoice | null {
  const choice = project?.metadata?.bgm_choice;
  return choice && typeof choice === "object" ? choice as BGMChoice : null;
}

export default function EditorView({
  jobId,
  assetId,
  token,
  embed,
  mode = "edit",
  previewChannel = null,
  initialSegmentId = null,
  openMaterialPicker = false,
}: {
  jobId: string | null;
  assetId: string | null;
  token: string | null;
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
  const startedRef = useRef(false);
  const exportBusyRef = useRef(false);
  const readyAcknowledgedRef = useRef(false);
  const loadedProjectRef = useRef<BackendProject | null>(null);
  const previewOnly = mode === "preview";

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", disposeEditor);
    return () => window.removeEventListener("pagehide", disposeEditor);
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

  const handleEmbeddedExport = useCallback(async () => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    try {
      const serialized = serializeBackendProject(EditorCore.getInstance());
      const currentProject = (
        Array.isArray(serialized.tracks)
          ? serialized
          : serialized.timeline && typeof serialized.timeline === "object"
            ? serialized.timeline
            : serialized
      ) as unknown as BackendProject;
      const localReport = inspectEditorProject(currentProject);
      if (localReport.blockers.length) {
        postToParent({ type: "multimix-editor-export-quality-report", report: localReport });
      }
      if (!assetId || !token) throw new Error("缺少成片验证所需的项目身份信息");
      postToParent({ type: "multimix-editor-export-start" });
      const result = await EditorCore.getInstance().renderer.exportProject({
        options: { format: "mp4", quality: "high", includeAudio: true },
        onProgress: ({ progress }) => postToParent({ type: "multimix-editor-export-progress", progress }),
      });
      if (!result.success || !result.buffer) {
        throw new Error(result.error || "未知错误");
      }
      const mime = getExportMimeType({ format: "mp4" });
      const blob = new Blob([result.buffer], { type: mime });
      postToParent({ type: "multimix-editor-export-verifying" });
      const formData = new FormData();
      formData.append("file", blob, `video-${Date.now()}.mp4`);
      const verifyResponse = await fetch(
        `${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}/exports/verify`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      );
      const verifyPayload = await verifyResponse.json().catch(() => null) as VideoQualityReport | { detail?: string } | null;
      if (!verifyResponse.ok) {
        throw new Error(
          verifyPayload && "detail" in verifyPayload && typeof verifyPayload.detail === "string"
            ? verifyPayload.detail
            : `成片检查失败（HTTP ${verifyResponse.status}）`,
        );
      }
      const verifiedReport = verifyPayload as VideoQualityReport;
      if (verifiedReport.blockers?.length) {
        postToParent({ type: "multimix-editor-export-quality-report", report: verifiedReport });
      }
      const saveResponse = await fetch(
        `${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}/mp4`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": mime,
          },
          body: blob,
        },
      );
      if (!saveResponse.ok) {
        const savePayload = await saveResponse.json().catch(() => null) as { detail?: string } | null;
        throw new Error(
          savePayload?.detail || `成片保存失败（HTTP ${saveResponse.status}）`,
        );
      }
      // Rendering and remote verification take long enough that the original
      // click's browser user activation has expired. Hand the verified and
      // persisted Blob to the parent and let a fresh, explicit download click
      // consume it.
      postToParent({ type: "multimix-editor-export-success", report: verifiedReport, blob });
    } catch (cause) {
      postToParent({
        type: "multimix-editor-export-error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      exportBusyRef.current = false;
    }
  }, [
    assetId,
    postToParent,
    token,
  ]);

  const persistCurrentProject = useCallback(async () => {
    if (!assetId) throw new Error("缺少项目 ID");
    const body = serializeBackendProject(EditorCore.getInstance());
    const res = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    await res.json().catch(() => null);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rememberRawProject(body);
    loadedProjectRef.current = unwrapProject(body);
  }, [assetId, token]);

  const handleBgmProjectChanged = useCallback(async (result: BGMUpdateResponse) => {
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
        const loadedProject = await fetchProject(endpoint, token);
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
  }, [jobId, assetId, token, postToParent]);

  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if ((data as { source?: string }).source !== "multimix-workspace") return;
      const message = data as { type?: string; time?: number };
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
      if (state !== "ready") {
        if (message.type === "multimix-editor-export") {
          postToParent({ type: "multimix-editor-export-error", message: "剪辑器尚未准备完成" });
        }
        return;
      }
      const editor = EditorCore.getInstance();
      if (message.type === "multimix-editor-export") {
        void handleEmbeddedExport();
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
    publishPreviewState();
    return unsubscribe;
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
                assetId={assetId}
                token={token}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {state === "ready" ? (
        previewOnly ? (
          <div className="editor-preview-only">
            <PreviewPanel />
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
