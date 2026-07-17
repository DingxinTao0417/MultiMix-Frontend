"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initEditorWithProject } from "@/editor-engine/vendor/bootstrap";
import type { BackendProject } from "@/editor-engine/vendor/buildProject";
import { EditorCore } from "@editor/core";
import { Timeline } from "@editor/components/editor/panels/timeline";
import { PreviewPanel } from "@editor/components/editor/panels/preview";
import { ExportButton } from "@/editor-engine/vendor/ExportButton";
import { ReplacePanel } from "@/editor-engine/vendor/ReplacePanel";
import { API_BASE } from "@/editor-engine/vendor/api";
import { rememberRawProject, serializeBackendProject } from "@/editor-engine/vendor/serializeProject";
import { inspectEditorProject } from "@/editor-engine/vendor/quality/preflight";
import type { VideoQualityReport } from "@/app/assets/lib/video-quality";
import { getExportMimeType } from "@editor/lib/export";
import { UI_V3_FILMSTRIP } from "@/app/assets/lib/ui-flags";
import FilmStrip from "./FilmStrip";

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

async function fetchProject(endpoint: string, token: string | null): Promise<BackendProject> {
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
  // ChangeIn format: video_project.timeline has the BackendProject shape.
  // video_orchestration format: the project itself IS the BackendProject.
  if (raw.tracks) return raw as BackendProject;
  if (raw.timeline && raw.timeline.tracks) return raw.timeline as BackendProject;
  throw new Error("项目格式不兼容（缺少 tracks）");
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
  const startedRef = useRef(false);
  const exportBusyRef = useRef(false);
  const previewOnly = mode === "preview";

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
        postToParent({ type: "multimix-editor-export-blocked", report: localReport });
        return;
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
        postToParent({ type: "multimix-editor-export-blocked", report: verifiedReport });
        return;
      }
      // Rendering and remote verification take long enough that the original
      // click's browser user activation has expired. Hand the verified Blob to
      // the parent and let a fresh, explicit download click consume it.
      postToParent({ type: "multimix-editor-export-success", report: verifiedReport, blob });
    } catch (cause) {
      postToParent({
        type: "multimix-editor-export-error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      exportBusyRef.current = false;
    }
  }, [assetId, postToParent, token]);

  const handleSave = async () => {
    if (!assetId || !token || saveState === "saving") return;
    setSaveState("saving");
    try {
      const body = serializeBackendProject(EditorCore.getInstance());
      const res = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        const bp = await fetchProject(endpoint, token);
        await initEditorWithProject(bp, (loaded, total) => {
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
  }, [embed, state, handleEmbeddedExport, postToParent, previewOnly]);

  useEffect(() => {
    if (!embed || !previewOnly || state !== "ready") return;
    const editor = EditorCore.getInstance();
    const publish = () => postToParent({
      type: "multimix-editor-preview-state",
      time: editor.playback.getCurrentTime(),
      playing: editor.playback.getIsPlaying(),
      duration: editor.timeline.getTotalDuration(),
    });
    const unsubscribe = editor.playback.subscribe(publish);
    publish();
    return unsubscribe;
  }, [embed, postToParent, previewOnly, state]);

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
            {state === "ready" ? <ExportButton assetId={assetId} token={token} /> : null}
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
            </div>
            <div className="editor-timeline-region">
              {embed && UI_V3_FILMSTRIP ? (
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
