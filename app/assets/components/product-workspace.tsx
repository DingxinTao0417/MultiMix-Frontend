"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { videoJobStageLabel } from "../../../lib/asset-mappers";
import { getProductModeLabel, getProductRatioClass, stringValue, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import { UI_V3_GENERATING_VISUALS } from "../lib/ui-flags";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { AssetProductSegment, SegmentMaterialOption } from "../lib/asset-workspace-types";
import { hasBlockingVideoIssues, type VideoQualityIssue, type VideoQualityReport } from "../lib/video-quality";
import type { VideoJobLiveStatus } from "./assets-workspace-client";
import AssetPicker from "./asset-picker";
import ProductPreview from "./product-preview";
import VideoQualityPanel from "./video-quality-panel";

type EditorBridgeMessage = {
  source?: string;
  assetId?: string | number | null;
  type?: string;
  progress?: number;
  message?: string;
  report?: VideoQualityReport;
};

export function EmptyProductWorkspace() {
  return (
    <section className="shadcn-prototype-card shadcn-prototype-artifact" aria-label="Empty product workspace">
      <div className="shadcn-prototype-product">
        <header className="shadcn-prototype-product-header">
          <div>
            <h3>等待确认创作方向</h3>
            <p>还没有生成产物</p>
          </div>
        </header>
        <div className="shadcn-prototype-product-main">
          <div className="shadcn-prototype-product-preview">
            <div>
              <strong>先从对话开始</strong>
              <span>明确要文案、图片或视频后，这里会展示生成结果。</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProductWorkspace({
  copied,
  onCopyProduct,
  onSaveProduct,
  onProductUpdated,
  onRestoreVersion,
  onRetryVideoJob,
  product,
  savedVersion,
  selectedConversation,
  token,
  videoJobLive,
}: {
  copied: boolean;
  onCopyProduct: (product: ProductArtifact) => Promise<void>;
  onSaveProduct: (product: ProductArtifact) => Promise<void>;
  onProductUpdated?: (product: ProductArtifact) => void;
  onRestoreVersion?: (product: ProductArtifact, versionId: string) => Promise<void>;
  onRetryVideoJob?: (product: ProductArtifact) => Promise<void>;
  product: ProductArtifact;
  savedVersion?: string;
  selectedConversation: Conversation;
  token?: string | null;
  videoJobLive?: VideoJobLiveStatus | null;
}) {
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "checking" | "exporting" | "verifying" | "blocked" | "done" | "error">("idle");
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [qualityReport, setQualityReport] = useState<VideoQualityReport | null>(null);
  const [exportError, setExportError] = useState("");
  const [materialPickerSegment, setMaterialPickerSegment] = useState<AssetProductSegment | null>(null);
  const [materialRecommended, setMaterialRecommended] = useState<SegmentMaterialOption[]>([]);
  const [materialLibrary, setMaterialLibrary] = useState<SegmentMaterialOption[]>([]);
  const [materialPickerState, setMaterialPickerState] = useState<"idle" | "loading" | "submitting">("idle");
  const [materialError, setMaterialError] = useState("");
  const [materialJobId, setMaterialJobId] = useState("");
  const editorFrameRef = useRef<HTMLIFrameElement | null>(null);
  const modeLabel = getProductModeLabel(product.mode);
  const hasSpeechTimeline = product.mode === "digital-human" && product.timeline.some((item) => item.line);
  const productMetadata = (product.metadata && typeof product.metadata === "object"
    ? product.metadata
    : {}) as Record<string, unknown>;
  // Video products backed by a real orchestration project can open the editor.
  const hasVideoProject = Boolean(product.backendAssetId && product.videoProjectReady);
  // While the orchestration job runs (TTS + material search), there is no
  // editable project yet; surface stage-level progress instead of the editor.
  const orchestrationPending = Boolean(
    product.backendAssetId && !hasVideoProject && productMetadata.orchestration_pending
  ) || (!hasVideoProject && videoJobLive?.status === "running") || (!hasVideoProject && videoJobLive?.status === "queued");
  // Failed jobs keep latest_job_public_id in metadata; the poller/mapper marks
  // the asset failed. Show a persistent error card with a retry action.
  const orchestrationFailed = !hasVideoProject && !orchestrationPending && Boolean(
    (videoJobLive?.status === "failed")
    || (typeof productMetadata.latest_job_public_id === "string" && product.status.includes("失败"))
  );
  // The pending pill still surfaces the coarse stage label; the step-by-step
  // timeline itself is owned by the conversation, not the display area.
  const liveStageLabel = videoJobStageLabel(videoJobLive?.renderStage ?? "queued");
  const failureDetail = videoJobLive?.errorMessage
    || (typeof productMetadata.error_message === "string" ? productMetadata.error_message : "")
    || "";
  const currentAssetId = product.backendAssetId ? String(product.backendAssetId) : null;
  // Demo-final video surfaces (workspace-video.html): "browse" (player when an
  // MP4 exists, otherwise segment cards from video_project) is the default;
  // "edit" (embedded editor) is opt-in. The editor is never auto-shown just
  // because no MP4 was exported yet (spec §251: 工作视图默认放详情不占主展示区).
  const canBrowseVideo = hasVideoProject;
  const [videoSurface, setVideoSurface] = useState<"browse" | "edit">("browse");
  const showEditorEmbed = hasVideoProject && videoSurface === "edit";
  // ProductPreview renders its own browse state (poster/player + segment cards)
  // for any generated project — with or without an exported MP4, and even
  // without a backendAssetId (mock / externally-hosted). Mirror that here so the
  // legacy timeline strip never doubles up under it.
  const previewShowsBrowse = Boolean(product.videoProjectReady);
  // Image products download their real hero file; without a URL the button hides.
  const imageDownloadUrl = product.mode === "image"
    ? (() => {
      const candidate = stringValue(productMetadata.preview_url) || stringValue(productMetadata.thumbnail_url);
      return /^https?:\/\//i.test(candidate) || candidate.startsWith("/") ? candidate : "";
    })()
    : "";
  const isFailedStatus = /失败/.test(product.status);
  const isDoneStatus = /^已(完成|生成|渲染)/.test(product.status);
  const previewClassName = [
    "shadcn-prototype-product-preview",
    product.mode,
    product.mode === "video" && !previewShowsBrowse ? "shadcn-prototype-stage-scroll-surface" : "",
    getProductRatioClass(product.ratio)
  ].filter(Boolean).join(" ");

  useEffect(() => {
    setEditorReady(false);
    setExportState("idle");
    setExportProgress(null);
    setQualityReport(null);
    setExportError("");
  }, [currentAssetId, hasVideoProject]);

  useEffect(() => {
    // Switching products always lands on the browse surface; the editor is
    // re-entered explicitly per product (demo 默认态).
    setVideoSurface("browse");
    setMaterialPickerSegment(null);
    setMaterialJobId("");
    setMaterialError("");
  }, [currentAssetId]);

  useEffect(() => {
    if (!hasVideoProject || typeof window === "undefined" || !currentAssetId) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as EditorBridgeMessage;
      if (!data || typeof data !== "object" || data.source !== "multimix-editor") return;
      if (String(data.assetId ?? "") !== currentAssetId) return;
      switch (data.type) {
        case "multimix-editor-ready":
          setEditorReady(true);
          setExportState((previous) => previous === "exporting" ? previous : "idle");
          setExportProgress(null);
          break;
        case "multimix-editor-error":
          setEditorReady(false);
          setExportState("error");
          setExportProgress(null);
          break;
        case "multimix-editor-export-start":
          setEditorReady(true);
          setExportState("exporting");
          setExportProgress(null);
          setExportError("");
          break;
        case "multimix-editor-export-progress":
          setExportState("exporting");
          setExportProgress(typeof data.progress === "number" ? data.progress : null);
          break;
        case "multimix-editor-export-success":
          if (data.report) setQualityReport(data.report);
          setExportState("done");
          setExportProgress(100);
          setExportError("");
          break;
        case "multimix-editor-export-verifying":
          setExportState("verifying");
          setExportProgress(100);
          break;
        case "multimix-editor-export-blocked":
          if (data.report) setQualityReport(data.report);
          setExportState("blocked");
          setExportProgress(null);
          setExportError("");
          break;
        case "multimix-editor-export-error":
          setExportState("error");
          setExportProgress(null);
          setExportError(data.message || "成片合成失败，请重试。");
          break;
        case "multimix-editor-recompose-started":
          // The film strip kicked off a segment recompose: the embed reloads
          // itself when the rebuilt project lands, so just gate export until
          // the fresh editor says ready again.
          setEditorReady(false);
          setExportState("idle");
          setExportProgress(null);
          setExportError("");
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [currentAssetId, hasVideoProject]);

  const requestExportQuality = async (): Promise<VideoQualityReport | null> => {
    if (!token || !product.backendAssetId) {
      setExportState("error");
      setExportError("导出身份信息不可用，请重新登录后重试。");
      return null;
    }
    setExportState("checking");
    setExportProgress(null);
    setExportError("");
    try {
      const report = await assetWorkspaceAdapter.getVideoQuality(token, product.backendAssetId);
      setQualityReport(report);
      setExportState("idle");
      return report;
    } catch {
      setExportState("error");
      setExportError("导出前检查失败，请重试。");
      return null;
    }
  };

  const handleExportVideo = async () => {
    if (!currentAssetId || !editorReady || ["exporting", "checking", "verifying"].includes(exportState)) return;
    const frameWindow = editorFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    const report = await requestExportQuality();
    if (!report || hasBlockingVideoIssues(report)) return;
    setExportState("exporting");
    setExportProgress(null);
    setExportError("");
    frameWindow.postMessage(
      {
        source: "multimix-workspace",
        type: "multimix-editor-export",
      },
      window.location.origin
    );
  };

  const locateQualityIssue = (segmentId: string, objectType: string) => {
    setVideoSurface("edit");
    window.requestAnimationFrame(() => {
      editorFrameRef.current?.contentWindow?.postMessage(
        {
          source: "multimix-workspace",
          type: "multimix-editor-locate-segment",
          segmentId,
          objectType,
        },
        window.location.origin,
      );
    });
  };

  const exportButtonLabel = !editorReady
    ? "导出准备中…"
    : exportState === "checking"
      ? "正在检查…"
    : exportState === "verifying"
      ? "正在检查成片…"
    : exportState === "exporting"
      ? `导出中 ${exportProgress == null ? "…" : `${Math.round(exportProgress)}%`}`
      : exportState === "done"
        ? "再次导出"
        : exportState === "error"
          ? "导出失败，重试"
          : exportState === "blocked"
            ? "修复后重新检查"
          : "导出视频";

  const openBrowseMaterialPicker = useCallback(async (segment: AssetProductSegment) => {
    setMaterialPickerSegment(segment);
    setMaterialRecommended([]);
    setMaterialLibrary([]);
    setMaterialError("");
    if (!token || !product.backendAssetId) {
      setMaterialPickerState("idle");
      setMaterialError("当前未连接素材服务，暂时无法更换素材。");
      return;
    }
    setMaterialPickerState("loading");
    try {
      const options = await assetWorkspaceAdapter.loadSegmentMaterialOptions(token, product.backendAssetId, segment.id);
      setMaterialRecommended(options.recommended);
      setMaterialLibrary(options.library);
    } catch (cause) {
      setMaterialError(cause instanceof Error ? cause.message : "素材加载失败，请重试。");
    } finally {
      setMaterialPickerState("idle");
    }
  }, [product.backendAssetId, token]);

  const canRepairQualityIssue = (issue: VideoQualityIssue): boolean => (
    Boolean(issue.segment_id)
    && ["main_track_gap", "naked_black_interval"].includes(issue.code)
    && Boolean(product.segments?.some((segment) => segment.id === issue.segment_id))
  );

  const repairQualityIssue = (issue: VideoQualityIssue) => {
    const segment = product.segments?.find((item) => item.id === issue.segment_id);
    if (segment) void openBrowseMaterialPicker(segment);
  };

  const replaceBrowseMaterial = useCallback(async (item: SegmentMaterialOption) => {
    if (!token || !product.backendAssetId || !materialPickerSegment) return;
    setMaterialPickerState("submitting");
    setMaterialError("");
    try {
      let result = await assetWorkspaceAdapter.replaceSegmentMaterial(
        token,
        product.backendAssetId,
        materialPickerSegment.id,
        Number(item.id),
      );
      if (result.kind === "confirm_overwrite") {
        if (!window.confirm(result.message)) {
          setMaterialPickerState("idle");
          return;
        }
        result = await assetWorkspaceAdapter.replaceSegmentMaterial(
          token,
          product.backendAssetId,
          materialPickerSegment.id,
          Number(item.id),
          true,
        );
      }
      if (result.kind === "started") {
        setMaterialPickerSegment(null);
        setMaterialJobId(result.job.id);
      }
    } catch (cause) {
      setMaterialError(cause instanceof Error ? cause.message : "素材替换失败，请重试。");
    } finally {
      setMaterialPickerState("idle");
    }
  }, [materialPickerSegment, product.backendAssetId, token]);

  useEffect(() => {
    if (!materialJobId || !token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const job = await assetWorkspaceAdapter.getVideoJob(token, materialJobId);
        if (cancelled) return;
        if (job.status === "failed") {
          setMaterialJobId("");
          setMaterialError(job.errorMessage || "素材替换失败，请重试。");
          return;
        }
        if (job.status !== "completed") return;
        setMaterialJobId("");
        if (!onProductUpdated || selectedConversation.id === "new") return;
        const refreshed = await assetWorkspaceAdapter.loadConversationDetail(token, selectedConversation.id);
        if (cancelled) return;
        const updated = (refreshed.products ?? [refreshed.product]).find(
          (item) => item.backendAssetId === product.backendAssetId,
        );
        if (updated) onProductUpdated(updated);
      } catch {
        // Keep polling transient failures; the job remains the source of truth.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [materialJobId, onProductUpdated, product.backendAssetId, selectedConversation.id, token]);

  const handleDownloadImage = async () => {
    if (!imageDownloadUrl) return;
    try {
      const response = await fetch(imageDownloadUrl);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = /\.[A-Za-z0-9]{2,6}$/.test(product.title) ? product.title : `${product.title || "image"}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(imageDownloadUrl, "_blank", "noopener");
    }
  };

  // Aurora + "生成中" badge only during the real generating state (spec §5.3 /
  // §12): while orchestration runs. Gated by flag; no fake progress.
  const showGeneratingVisuals = UI_V3_GENERATING_VISUALS && orchestrationPending;
  const artifactClassName = [
    "shadcn-prototype-card",
    "shadcn-prototype-artifact",
    showGeneratingVisuals ? "generating" : ""
  ].filter(Boolean).join(" ");

  return (
    <section className={artifactClassName} aria-label="Current product workspace">
      <div className={hasVideoProject ? "shadcn-prototype-product video-project-mode" : "shadcn-prototype-product"}>
        <header className="shadcn-prototype-product-header">
          <div>
            <h3>
              <span className="shadcn-prototype-product-title-text">{product.title}</span>
              {showGeneratingVisuals ? (
                <span className="shadcn-prototype-artifact-generating-badge">
                  <span aria-hidden="true" />
                  生成中
                </span>
              ) : isFailedStatus ? (
                <span className="shadcn-prototype-product-status-pill fail">✕ {product.status}</span>
              ) : isDoneStatus ? (
                <span className="shadcn-prototype-product-status-pill ok">
                  <Check size={9} strokeWidth={3.2} aria-hidden="true" />
                  {product.status}
                </span>
              ) : null}
            </h3>
            <p>
              {[
                product.phase,
                isDoneStatus || isFailedStatus || showGeneratingVisuals ? null : product.status,
                `${product.ratio} / ${product.duration}`
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="shadcn-prototype-product-actions">
            <details className="shadcn-prototype-product-detail-popover">
              <summary className="shadcn-prototype-product-detail-trigger">详情</summary>
              <aside className="shadcn-prototype-product-detail-drawer" aria-label="生成详情">
                <header>
                  <div>
                    <span>生成详情</span>
                    <strong>{product.title}</strong>
                  </div>
                </header>

                <div className="shadcn-prototype-detail-status">
                  <article>
                    <span>当前状态</span>
                    <strong>{product.phase}</strong>
                    <em>{product.status}</em>
                  </article>
                  <article>
                    <span>来源依据</span>
                    <strong>{selectedConversation.assetLabel}</strong>
                    <em>{selectedConversation.status}</em>
                  </article>
                  <article>
                    <span>规格</span>
                    <strong>{product.ratio} / {product.duration}</strong>
                    <em>{modeLabel}</em>
                  </article>
                </div>

                <section className="shadcn-prototype-detail-section">
                  <h4>内容与可调整项</h4>
                  <div className="shadcn-prototype-adjustment-list drawer">
                    {product.sections.map((section) => (
                      <article key={`${section.label}-${section.title}`}>
                        <div>
                          <span>{section.label}</span>
                          <strong>{section.title}</strong>
                        </div>
                        <p>{section.detail}</p>
                        <em>{section.status}</em>
                      </article>
                    ))}
                  </div>
                </section>

                {product.versions && product.versions.length > 0 ? (
                  <section className="shadcn-prototype-detail-section">
                    <h4>版本历史</h4>
                    <div className="shadcn-prototype-version-list">
                      {product.versions.map((version) => {
                        const isCurrent = version.label === product.version;
                        return (
                          <article key={version.id}>
                            <div>
                              <strong>{version.label}</strong>
                              <span>{version.status}</span>
                              <em>{version.savedAt}</em>
                            </div>
                            <button
                              type="button"
                              disabled={isCurrent || !onRestoreVersion || restoringVersionId === version.id}
                              onClick={async () => {
                                if (!onRestoreVersion) return;
                                setRestoringVersionId(version.id);
                                try {
                                  await onRestoreVersion(product, version.id);
                                } finally {
                                  setRestoringVersionId(null);
                                }
                              }}
                            >
                              {isCurrent ? "当前" : restoringVersionId === version.id ? "恢复中..." : "恢复"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

              </aside>
            </details>
            {product.mode === "copy" ? (
              <button type="button" className="primary" onClick={() => void onCopyProduct(product)}>
                {copied ? "已复制" : "复制全文"}
              </button>
            ) : null}
            {product.mode === "image" && imageDownloadUrl ? (
              <button type="button" className="primary" onClick={() => void handleDownloadImage()}>
                下载
              </button>
            ) : null}
            {canBrowseVideo && videoSurface === "browse" ? (
              <button type="button" className="primary" onClick={() => setVideoSurface("edit")}>
                <Pencil size={12} aria-hidden="true" />
                编辑
              </button>
            ) : null}
            {showEditorEmbed ? (
              <button type="button" className="primary" onClick={() => setVideoSurface("browse")}>
                完成编辑
              </button>
            ) : null}
            {canBrowseVideo ? (
              <button
                type="button"
                className="shadcn-prototype-open-editor"
                disabled={!editorReady || ["exporting", "checking", "verifying"].includes(exportState) || hasBlockingVideoIssues(qualityReport)}
                onClick={() => void handleExportVideo()}
              >
                {exportButtonLabel}
              </button>
            ) : null}
            {orchestrationPending ? (
              <span className="shadcn-prototype-product-pending" aria-live="polite">
                {liveStageLabel}
              </span>
            ) : null}
            <button type="button" onClick={() => void onSaveProduct(product)}>
              {savedVersion ? `已保存 ${savedVersion}` : "保存"}
            </button>
          </div>
        </header>

        {qualityReport && (qualityReport.blockers.length || qualityReport.warnings.length) ? (
          <VideoQualityPanel
            report={qualityReport}
            onLocate={locateQualityIssue}
            onRepair={repairQualityIssue}
            canRepair={canRepairQualityIssue}
            onRecheck={() => void requestExportQuality()}
          />
        ) : null}

        {exportState === "error" && exportError ? (
          <div className="shadcn-prototype-video-failed" role="alert">
            <strong>导出失败</strong>
            <p>{exportError}</p>
          </div>
        ) : null}

        {hasVideoProject ? (
          <div className={showEditorEmbed ? "shadcn-prototype-product-main shadcn-prototype-editor-host" : "shadcn-prototype-export-bridge-host"}>
            <iframe
              ref={editorFrameRef}
              key={`editor-${product.backendAssetId}`}
              className={showEditorEmbed ? "shadcn-prototype-editor-frame" : "shadcn-prototype-export-bridge"}
              src={`/editor?asset=${encodeURIComponent(String(product.backendAssetId))}&embed=1`}
              title="视频剪辑器"
              allow="autoplay; clipboard-write"
            />
          </div>
        ) : null}

        {!showEditorEmbed && previewShowsBrowse ? (
          <div className="shadcn-prototype-product-main">
            <ProductPreview
              product={product}
              onReplaceMaterial={openBrowseMaterialPicker}
            />
          </div>
        ) : !showEditorEmbed && orchestrationPending ? (
          <div className="shadcn-prototype-product-main">
            {/* The step-by-step execution timeline lives in the conversation
                (spec video-confirmation-execution-card §5.2 / agentic-workbench
                §194). The display area only shows a calm waiting state; it must
                not duplicate the execution card here. */}
            <div className="shadcn-prototype-video-progress" role="status" aria-live="polite">
              <span className="shadcn-prototype-video-progress-shimmer" aria-hidden="true" />
              <strong>视频工程生成中</strong>
              <p>生成进度在对话区实时更新，完成后这里会自动展示剪辑器。</p>
            </div>
          </div>
        ) : !showEditorEmbed && orchestrationFailed ? (
          <div className="shadcn-prototype-product-main">
            <div className="shadcn-prototype-video-failed" role="alert">
              <strong>视频生成失败</strong>
              <p>{failureDetail || "任务在后台执行时出错，工程未能生成。"}</p>
              <div className="shadcn-prototype-video-failed-actions">
                {onRetryVideoJob ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={retrying}
                    onClick={async () => {
                      setRetrying(true);
                      try {
                        await onRetryVideoJob(product);
                      } finally {
                        setRetrying(false);
                      }
                    }}
                  >
                    {retrying ? "重试中…" : "↻ 重试生成"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("multimix:composer-focus"))}
                >
                  回对话调整
                </button>
              </div>
            </div>
          </div>
        ) : !showEditorEmbed && !hasVideoProject ? (
          <div className="shadcn-prototype-product-main">
            <div className={previewClassName}>
              <ProductPreview product={product} />
            </div>
          </div>
        ) : null}

        {materialJobId ? (
          <p className="shadcn-prototype-material-recompose-status" role="status">正在重新合成当前分镜，完成后会自动刷新。</p>
        ) : materialError && !materialPickerSegment ? (
          <p className="shadcn-prototype-material-recompose-error" role="alert">{materialError}</p>
        ) : null}

        <AssetPicker
          open={Boolean(materialPickerSegment)}
          title={`为分镜 #${materialPickerSegment?.index ?? "-"} 换素材`}
          subtitle="替换后只更新当前分镜，不影响其他分镜。"
          ratio={product.ratio}
          recommended={materialRecommended}
          library={materialLibrary}
          loading={materialPickerState === "loading"}
          submitting={materialPickerState === "submitting"}
          error={materialError}
          onSelect={(item) => void replaceBrowseMaterial(item)}
          onClose={() => {
            if (materialPickerState === "submitting") return;
            setMaterialPickerSegment(null);
            setMaterialError("");
          }}
        />

        {!hasVideoProject && !previewShowsBrowse && product.timeline.length > 0 ? (
          <section
            className={hasSpeechTimeline ? "shadcn-prototype-product-timeline-strip speech" : "shadcn-prototype-product-timeline-strip"}
            aria-label={hasSpeechTimeline ? "音轨和字幕时间轴" : "时间轴预览"}
          >
            <div className="shadcn-prototype-product-timeline-items">
              {product.timeline.map((item) => (
                <article key={`${item.time}-${item.title}`}>
                  <time>{item.time}</time>
                  <strong>{item.title}</strong>
                  <span>{item.line ?? item.status}</span>
                  {item.line ? <em>{item.status}</em> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

      </div>
    </section>
  );
}
