"use client";

import { useEffect, useRef, useState } from "react";
import { VIDEO_JOB_STEPS, videoJobStageLabel, videoJobStepIndex, videoJobTimelineSteps } from "../../../lib/asset-mappers";
import { getProductModeLabel, getProductRatioClass, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import { UI_V3_AGENT_TIMELINE, UI_V3_GENERATING_VISUALS } from "../lib/ui-flags";
import type { VideoJobLiveStatus } from "./assets-workspace-client";
import AgentRunTimeline from "./agent-run-timeline";
import ProductPreview from "./product-preview";

type EditorBridgeMessage = {
  source?: string;
  assetId?: string | number | null;
  type?: string;
  progress?: number;
  message?: string;
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
  onRestoreVersion,
  onRetryVideoJob,
  product,
  savedVersion,
  selectedConversation,
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
  const [exportState, setExportState] = useState<"idle" | "exporting" | "done" | "error">("idle");
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const editorFrameRef = useRef<HTMLIFrameElement | null>(null);
  const modeLabel = getProductModeLabel(product.mode);
  const hasSpeechTimeline = product.mode === "digital-human" && product.timeline.some((item) => item.line);
  const productMetadata = (product.metadata && typeof product.metadata === "object"
    ? product.metadata
    : {}) as Record<string, unknown>;
  // Video products backed by a real orchestration project can open the editor.
  const hasVideoProject = Boolean(product.backendAssetId && productMetadata.video_project);
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
  const liveStage = videoJobLive?.renderStage ?? "queued";
  const liveStageLabel = videoJobStageLabel(liveStage);
  const liveStepIndex = videoJobStepIndex(liveStage);
  const failureDetail = videoJobLive?.errorMessage
    || (typeof productMetadata.error_message === "string" ? productMetadata.error_message : "")
    || "";
  const currentAssetId = product.backendAssetId ? String(product.backendAssetId) : null;
  const previewClassName = [
    "shadcn-prototype-product-preview",
    product.mode,
    getProductRatioClass(product.ratio)
  ].filter(Boolean).join(" ");

  useEffect(() => {
    setEditorReady(false);
    setExportState("idle");
    setExportProgress(null);
  }, [currentAssetId, hasVideoProject]);

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
          break;
        case "multimix-editor-export-progress":
          setExportState("exporting");
          setExportProgress(typeof data.progress === "number" ? data.progress : null);
          break;
        case "multimix-editor-export-success":
          setExportState("done");
          setExportProgress(100);
          break;
        case "multimix-editor-export-error":
          setExportState("error");
          setExportProgress(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [currentAssetId, hasVideoProject]);

  const handleExportVideo = () => {
    if (!currentAssetId || !editorReady || exportState === "exporting") return;
    const frameWindow = editorFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    setExportState("exporting");
    setExportProgress(null);
    frameWindow.postMessage(
      {
        source: "multimix-workspace",
        type: "multimix-editor-export",
      },
      window.location.origin
    );
  };

  const exportButtonLabel = !editorReady
    ? "剪辑器加载中…"
    : exportState === "exporting"
      ? `导出中 ${exportProgress == null ? "…" : `${Math.round(exportProgress)}%`}`
      : exportState === "done"
        ? "再次导出"
        : exportState === "error"
          ? "导出失败，重试"
          : "导出视频";

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
              {product.title}
              {showGeneratingVisuals ? (
                <span className="shadcn-prototype-artifact-generating-badge">
                  <span aria-hidden="true" />
                  生成中
                </span>
              ) : null}
            </h3>
            <p>{product.phase} · {product.status} · {product.ratio} / {product.duration}</p>
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
              <button type="button" onClick={() => void onCopyProduct(product)}>
                {copied ? "已复制" : "复制"}
              </button>
            ) : null}
            {hasVideoProject ? (
              <button
                type="button"
                className="shadcn-prototype-open-editor"
                disabled={!editorReady || exportState === "exporting"}
                onClick={handleExportVideo}
              >
                {exportButtonLabel}
              </button>
            ) : null}
            {orchestrationPending ? (
              <span className="shadcn-prototype-product-pending" aria-live="polite">
                {liveStageLabel}
              </span>
            ) : null}
            <button className="primary" type="button" onClick={() => void onSaveProduct(product)}>
              {savedVersion ? `已保存 ${savedVersion}` : "保存"}
            </button>
          </div>
        </header>

        {hasVideoProject ? (
          <div className="shadcn-prototype-product-main" style={{ padding: 0, overflow: "hidden" }}>
            <iframe
              ref={editorFrameRef}
              key={`editor-${product.backendAssetId}`}
              src={`/editor?asset=${encodeURIComponent(String(product.backendAssetId))}&embed=1`}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              title="视频剪辑器"
              allow="autoplay; clipboard-write"
            />
          </div>
        ) : orchestrationPending ? (
          <div className="shadcn-prototype-product-main">
            <div className="shadcn-prototype-video-progress" role="status" aria-live="polite">
              <strong>视频工程生成中</strong>
              {UI_V3_AGENT_TIMELINE ? (
                <AgentRunTimeline steps={videoJobTimelineSteps(liveStage, videoJobLive?.status ?? "running")} />
              ) : (
                <ol className="shadcn-prototype-video-progress-steps">
                  {VIDEO_JOB_STEPS.map((step, index) => (
                    <li
                      key={step}
                      className={index < liveStepIndex ? "done" : index === liveStepIndex ? "active" : ""}
                    >
                      <i aria-hidden="true" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p>{liveStageLabel}。可以切换到其他对话，完成后这里会自动展示剪辑器。</p>
            </div>
          </div>
        ) : orchestrationFailed ? (
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
                    {retrying ? "重试中…" : "重试生成"}
                  </button>
                ) : null}
                <span>也可以在对话中调整指令后重新生成。</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="shadcn-prototype-product-main">
            <div className={previewClassName}>
              <ProductPreview product={product} />
            </div>
          </div>
        )}

        {!hasVideoProject && product.timeline.length > 0 ? (
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
