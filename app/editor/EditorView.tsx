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
import type { BGMUpdateResponse } from "@/editor-engine/vendor/api";
import { rememberRawProject, serializeBackendProject } from "@/editor-engine/vendor/serializeProject";
import { inspectEditorProject } from "@/editor-engine/vendor/quality/preflight";
import type { VideoQualityReport } from "@/app/assets/lib/video-quality";
import { getExportMimeType } from "@editor/lib/export";
import { UI_V3_FILMSTRIP } from "@/app/assets/lib/ui-flags";
import {
  captureRenderedReviewFrames,
  deriveSceneReviewWindows,
  fetchLatestRenderedReview,
  isRenderedReviewExportReady,
  retryLatestRenderedReview,
  shouldCaptureRenderedReview,
  shouldPollRenderedReview,
  uploadRenderedReviewFrames,
  type RenderedReviewState,
} from "@/editor-engine/vendor/renderedReview";
import FilmStrip from "./FilmStrip";
import BgmPanel from "./BgmPanel";

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

type LoadedProject = {
  project: BackendProject;
  renderedReviewRequired: boolean;
  renderedReviewCaptureReady: boolean;
  projectFingerprint: string;
  renderedReview: RenderedReviewState | null;
};

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
  const result = data.result && typeof data.result === "object"
    ? data.result as Record<string, unknown>
    : {};
  const review = result.rendered_review && typeof result.rendered_review === "object"
    ? result.rendered_review as RenderedReviewState
    : null;
  return {
    project: unwrapProject(raw),
    renderedReviewRequired: result.rendered_review_required === true,
    renderedReviewCaptureReady:
      result.rendered_review_capture_ready !== false,
    projectFingerprint:
      typeof result.project_fingerprint === "string"
        ? result.project_fingerprint
        : "",
    renderedReview: review,
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

function renderedReviewBlockingReport(
  review: RenderedReviewState | null,
): VideoQualityReport {
  const firstIssue = review?.issues[0];
  return {
    stage: "export_preflight",
    status: "blocked",
    blockers: [{
      code: review?.status === "stale"
        ? "rendered_review_stale"
        : review?.status === "unavailable"
          ? "rendered_review_unavailable"
          : review?.status === "blocked" || review?.status === "blocked_requires_user_choice"
            ? "rendered_review_blocked"
            : "rendered_review_pending",
      segment_id: firstIssue?.scene_id ?? null,
      object_type: "rendered_review",
      message: firstIssue?.reason
        ?? (review?.status === "unavailable"
          ? "画面检查暂不可用，当前不能标记为参考质量通过。"
          : "实际成片画面仍在检查或定点优化中。"),
      attempted_fallbacks: [],
      suggested_actions: ["等待画面检查完成后重新导出"],
    }],
    warnings: [],
  };
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
  const reviewRetryBusyRef = useRef(false);
  const loadedProjectRef = useRef<BackendProject | null>(null);
  const reviewCaptureKeyRef = useRef("");
  const [renderedReview, setRenderedReview] = useState<RenderedReviewState | null>(null);
  const [renderedReviewRequired, setRenderedReviewRequired] = useState(false);
  const [renderedReviewCaptureReady, setRenderedReviewCaptureReady] = useState(true);
  const [projectFingerprint, setProjectFingerprint] = useState("");
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

  const handleEmbeddedExport = useCallback(async () => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    try {
      if (
        !isRenderedReviewExportReady(
          renderedReviewRequired,
          renderedReview,
          projectFingerprint,
        )
      ) {
        postToParent({
          type: "multimix-editor-export-blocked",
          report: renderedReviewBlockingReport(renderedReview),
        });
        return;
      }
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
  }, [
    assetId,
    postToParent,
    projectFingerprint,
    renderedReview,
    renderedReviewRequired,
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
    const payload = await res.json().catch(() => null) as {
      project_fingerprint?: string;
      rendered_review?: RenderedReviewState;
    } | null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rememberRawProject(body);
    loadedProjectRef.current = unwrapProject(body);
    if (
      payload?.project_fingerprint
      && payload.rendered_review
    ) {
      setRenderedReviewRequired(true);
      setRenderedReviewCaptureReady(true);
      setProjectFingerprint(payload.project_fingerprint);
      setRenderedReview(payload.rendered_review);
    }
  }, [assetId, token]);

  const handleBgmProjectChanged = useCallback(async (result: BGMUpdateResponse) => {
    rememberRawProject(result.project);
    const project = unwrapProject(result.project);
    loadedProjectRef.current = project;
    await refreshMountedEditorProject(project);
    reviewCaptureKeyRef.current = "";
    if (result.project_fingerprint && result.rendered_review) {
      setRenderedReviewRequired(true);
      setRenderedReviewCaptureReady(true);
      setProjectFingerprint(result.project_fingerprint);
      setRenderedReview(result.rendered_review);
    }
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
        setRenderedReviewRequired(loadedProject.renderedReviewRequired);
        setRenderedReviewCaptureReady(
          loadedProject.renderedReviewCaptureReady,
        );
        setProjectFingerprint(loadedProject.projectFingerprint);
        setRenderedReview(loadedProject.renderedReview);
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
    if (!renderedReview) return;
    postToParent({
      type: "multimix-editor-rendered-review",
      renderedReview,
    });
  }, [postToParent, renderedReview]);

  useEffect(() => {
    if (
      state !== "ready"
      || !renderedReviewRequired
      || renderedReviewCaptureReady
      || (embed && !previewOnly)
    ) {
      return;
    }
    const endpoint = assetId
      ? `/v1/video/projects/${encodeURIComponent(assetId)}`
      : jobId
        ? `/v1/video/jobs/${encodeURIComponent(jobId)}`
        : null;
    if (!endpoint) return;
    let cancelled = false;
    let polling = false;

    const pollCaptureReadiness = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const loaded = await fetchProject(endpoint, token);
        if (cancelled) return;
        if (loaded.projectFingerprint !== projectFingerprint) {
          loadedProjectRef.current = loaded.project;
          await refreshMountedEditorProject(loaded.project);
          if (cancelled) return;
          reviewCaptureKeyRef.current = "";
        }
        setRenderedReviewRequired(loaded.renderedReviewRequired);
        setRenderedReviewCaptureReady(loaded.renderedReviewCaptureReady);
        setProjectFingerprint(loaded.projectFingerprint);
        setRenderedReview(loaded.renderedReview);
      } catch {
        // Project/MG status is still settling. Keep polling the isolated
        // project endpoint without capturing pixels from an obsolete version.
      } finally {
        polling = false;
      }
    };
    void pollCaptureReadiness();
    const timer = window.setInterval(
      () => void pollCaptureReadiness(),
      1500,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    assetId,
    embed,
    jobId,
    previewOnly,
    projectFingerprint,
    renderedReviewCaptureReady,
    renderedReviewRequired,
    state,
    token,
  ]);

  useEffect(() => {
    if (
      state !== "ready"
      || !assetId
      || !renderedReviewRequired
      || !projectFingerprint
      || !renderedReview
      || !shouldCaptureRenderedReview(
        renderedReview,
        renderedReviewCaptureReady,
      )
      // The normal browse preview is the single review owner. A standalone
      // editor owns its own review, while a second embedded edit/export iframe
      // must not race the preview iframe and duplicate paid review work.
      || (embed && !previewOnly)
    ) {
      return;
    }
    const attempt = Math.max(1, renderedReview.attempt || 1);
    const captureKey = `${assetId}:${projectFingerprint}:${attempt}`;
    if (reviewCaptureKeyRef.current === captureKey) return;
    reviewCaptureKeyRef.current = captureKey;
    let cancelled = false;

    void (async () => {
      const editor = EditorCore.getInstance();
      try {
        // PreviewPanel publishes the final render tree just after this effect's
        // first paint. Wait briefly for that exact surface instead of rendering
        // from a separate approximation.
        for (let index = 0; index < 100 && !editor.renderer.getRenderTree(); index += 1) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
          if (cancelled) return;
        }
        if (!editor.renderer.getRenderTree()) {
          throw new Error("最终画布尚未准备好");
        }
        const project = loadedProjectRef.current;
        if (!project) throw new Error("缺少当前视频工程");
        const windows = deriveSceneReviewWindows(project);
        if (!windows.length) throw new Error("当前工程没有可审查的分镜");
        const captures = await captureRenderedReviewFrames(editor, windows);
        if (cancelled) return;
        const next = await uploadRenderedReviewFrames({
          assetId,
          token,
          projectFingerprint,
          attempt,
          idempotencyKey: `rendered-review:${assetId}:${projectFingerprint}:${attempt}`,
          captures,
          apiBase: API_BASE,
        });
        if (!cancelled) setRenderedReview(next);
      } catch (cause) {
        if (cancelled) return;
        reviewCaptureKeyRef.current = "";
        try {
          const persisted = await fetchLatestRenderedReview({
            assetId,
            token,
            apiBase: API_BASE,
          });
          if (!cancelled) setRenderedReview(persisted);
        } catch {
          setRenderedReview({
            status: "unavailable",
            project_fingerprint: projectFingerprint,
            attempt,
            issues: [],
          });
        }
        postToParent({
          type: "multimix-editor-rendered-review-error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    assetId,
    embed,
    previewOnly,
    projectFingerprint,
    renderedReview,
    renderedReviewCaptureReady,
    renderedReviewRequired,
    state,
    token,
    postToParent,
  ]);

  useEffect(() => {
    if (
      !assetId
      || !renderedReview
      || !shouldPollRenderedReview(renderedReview)
      || (embed && !previewOnly)
    ) {
      return;
    }
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling || cancelled) return;
      polling = true;
      try {
        const latest = await fetchLatestRenderedReview({
          assetId,
          token,
          apiBase: API_BASE,
        });
        if (cancelled) return;
        if (
          latest.project_fingerprint
          && latest.project_fingerprint !== projectFingerprint
        ) {
          const loaded = await fetchProject(
            `/v1/video/projects/${encodeURIComponent(assetId)}`,
            token,
          );
          if (cancelled) return;
          loadedProjectRef.current = loaded.project;
          await refreshMountedEditorProject(loaded.project);
          if (cancelled) return;
          reviewCaptureKeyRef.current = "";
          setRenderedReviewRequired(loaded.renderedReviewRequired);
          setRenderedReviewCaptureReady(loaded.renderedReviewCaptureReady);
          setProjectFingerprint(loaded.projectFingerprint);
          setRenderedReview(loaded.renderedReview);
          postToParent({
            type: "multimix-editor-project-updated",
            reason: "rendered-review-repair",
          });
          return;
        }
        setRenderedReview(latest);
      } catch {
        // A transient status-read failure must not turn a running repair into
        // either a false pass or a duplicate repair. The next poll retries.
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    assetId,
    embed,
    postToParent,
    previewOnly,
    projectFingerprint,
    renderedReview,
    token,
  ]);

  const retryRenderedReview = useCallback(async () => {
    if (
      !assetId
      || !renderedReviewRequired
      || renderedReview?.status !== "unavailable"
      || reviewRetryBusyRef.current
    ) {
      return;
    }
    reviewRetryBusyRef.current = true;
    try {
      const next = await retryLatestRenderedReview({
        assetId,
        token,
        idempotencyKey: `rendered-review-retry:${assetId}:${Date.now()}`,
        apiBase: API_BASE,
      });
      setRenderedReview(next);
    } catch (cause) {
      postToParent({
        type: "multimix-editor-rendered-review-error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      reviewRetryBusyRef.current = false;
    }
  }, [assetId, postToParent, renderedReview, renderedReviewRequired, token]);

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
      } else if (message.type === "multimix-editor-rendered-review-retry") {
        void retryRenderedReview();
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
    previewOnly,
    retryRenderedReview,
  ]);

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
            {state === "ready" ? (
              <ExportButton
                assetId={assetId}
                token={token}
                disabled={!isRenderedReviewExportReady(
                  renderedReviewRequired,
                  renderedReview,
                  projectFingerprint,
                )}
                disabledReason="画面检查通过后才能导出"
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
                  onPrepareChange={persistCurrentProject}
                  onProjectChanged={handleBgmProjectChanged}
                />
              ) : null}
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
