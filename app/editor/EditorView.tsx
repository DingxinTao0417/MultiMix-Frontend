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
import { getExportMimeType } from "@editor/lib/export";

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

export default function EditorView({ jobId, assetId, token, embed }: { jobId: string | null; assetId: string | null; token: string | null; embed?: boolean }) {
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadingDetail, setLoadingDetail] = useState("");
  const startedRef = useRef(false);
  const exportBusyRef = useRef(false);

  const postToParent = useCallback((payload: Record<string, unknown>) => {
    if (!embed || typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage(
      {
        source: "multimix-editor",
        assetId,
        ...payload,
      },
      window.location.origin
    );
  }, [assetId, embed]);

  const handleEmbeddedExport = useCallback(async () => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    postToParent({ type: "multimix-editor-export-start" });
    try {
      const result = await EditorCore.getInstance().renderer.exportProject({
        options: { format: "mp4", quality: "high", includeAudio: true },
        onProgress: ({ progress }) => postToParent({ type: "multimix-editor-export-progress", progress }),
      });
      if (!result.success || !result.buffer) {
        throw new Error(result.error || "未知错误");
      }
      const mime = getExportMimeType({ format: "mp4" });
      const blob = new Blob([result.buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `video-${Date.now()}.mp4`;
      anchor.click();
      URL.revokeObjectURL(url);
      postToParent({ type: "multimix-editor-export-success" });
    } catch (cause) {
      postToParent({
        type: "multimix-editor-export-error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      exportBusyRef.current = false;
    }
  }, [postToParent]);

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
      if ((data as { type?: string }).type !== "multimix-editor-export") return;
      if (state !== "ready") {
        postToParent({ type: "multimix-editor-export-error", message: "剪辑器尚未准备完成" });
        return;
      }
      void handleEmbeddedExport();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed, state, handleEmbeddedExport, postToParent]);

  return (
    <div className="editor-root">
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
        <div className="editor-layout">
          <div className="editor-preview-region">
            <PreviewPanel />
            <ReplacePanel assetId={assetId} token={token} />
          </div>
          <div className="editor-timeline-region">
            <Timeline />
          </div>
        </div>
      ) : (
        <div className="editor-loading-shell">
          {state === "error" ? error : loadingDetail || "正在准备剪辑器…"}
        </div>
      )}
    </div>
  );
}
