"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { API_BASE } from "../../../lib/api";
import { getProductRatioClass, isRecord, stringValue, type ProductArtifact } from "../lib/asset-workspace-shared";
import type { AssetProductSegment } from "../lib/asset-workspace-types";
import SegmentCards from "./segment-cards";
import SourceRefBlock from "./source-ref-block";
import StoryboardPreview from "./storyboard-preview";
import VideoPreviewPlayer from "./video-preview-player";
import {
  clampPreviewHeight,
  PREVIEW_DEFAULT_HEIGHT,
  PREVIEW_MIN_HEIGHT,
  previewMaxHeight,
  VideoPreviewResizer,
} from "./video-preview-resizer";

// Resolve a directly playable URL for a video-like product: exported MP4s live
// behind the backend media proxy (store refs), external sources pass through.
export function playableVideoUrl(product: ProductArtifact): string {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  const videoProject = isRecord(metadata.video_project) ? metadata.video_project : null;
  const mp4Ref = stringValue(videoProject?.mp4_ref);
  if (mp4Ref) return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(mp4Ref)}`;
  const mp4Artifact = isRecord(metadata.mp4_artifact) ? metadata.mp4_artifact : null;
  const artifactRef = stringValue(mp4Artifact?.mp4_ref) || stringValue(mp4Artifact?.ref);
  if (artifactRef) return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(artifactRef)}`;
  const direct = stringValue(metadata.video_url) || stringValue(metadata.preview_url);
  if (/^https?:\/\//i.test(direct)) return direct;
  return "";
}

function videoPlanSummary(product: ProductArtifact) {
  const plan = isRecord(product.metadata?.video_plan) ? product.metadata.video_plan : null;
  if (!plan) return null;
  const summary = isRecord(plan.summary) ? plan.summary : {};
  const scenes = Array.isArray(plan.scenes) ? plan.scenes.filter(isRecord) : [];
  const mgStyleProfile = isRecord(plan.mg_style_profile) ? plan.mg_style_profile : null;
  return {
    topic: stringValue(summary.topic) || product.title,
    audience: stringValue(plan.audience) || "潜在用户",
    style: stringValue(plan.style) || "清晰可信",
    mgStyle: stringValue(summary.mg_style_label) || stringValue(mgStyleProfile?.preset) || "科技",
    duration: typeof plan.duration_seconds === "number" ? `${plan.duration_seconds}秒` : product.duration,
    sceneCount: typeof summary.scene_count === "number" ? summary.scene_count : scenes.length,
    materialHitCount: typeof summary.material_hit_count === "number" ? summary.material_hit_count : 0,
    publicMaterialFillCount: typeof summary.public_material_fill_count === "number" ? summary.public_material_fill_count : 0,
    materialGapCount: typeof summary.material_gap_count === "number" ? summary.material_gap_count : 0,
    materialUnfilledCount: typeof summary.material_unfilled_count === "number" ? summary.material_unfilled_count : 0,
    mgNeededCount: typeof summary.mg_needed_count === "number" ? summary.mg_needed_count : 0,
    mgRenderedCount: typeof summary.mg_rendered_count === "number" ? summary.mg_rendered_count : 0,
    mgFailedCount: typeof summary.mg_failed_count === "number" ? summary.mg_failed_count : 0,
    scenes,
  };
}

function materialGapNotice(product: ProductArtifact, fallbackCount = 0) {
  const metadataNotice = product.metadata?.material_gap_notice;
  if (typeof metadataNotice === "string" && metadataNotice.trim()) return metadataNotice;
  const project = isRecord(product.metadata?.video_project) ? product.metadata.video_project : null;
  const orchestration = project && isRecord(project.orchestration) ? project.orchestration : null;
  const projectNotice = orchestration?.material_gap_notice;
  if (typeof projectNotice === "string" && projectNotice.trim()) return projectNotice;
  return fallbackCount > 0 ? `${fallbackCount} 个分镜未匹配到合适素材，已用字幕/标题卡占位，可在编辑器中替换。` : "";
}

function sceneAssetReferenceSummary(scene: Record<string, unknown>): string {
  const reference = isRecord(scene.asset_reference) ? scene.asset_reference : null;
  if (!reference) return "未写入素材引用";
  if (stringValue(reference.status) !== "matched") return "未命中素材";
  const snapshot = isRecord(reference.source_snapshot) ? reference.source_snapshot : null;
  const title = stringValue(snapshot?.title);
  const reason = stringValue(reference.match_reason);
  return title ? `已引用 ${title}` : (reason || "已命中素材");
}

function sceneMgDecisionSummary(scene: Record<string, unknown>): string {
  const decision = isRecord(scene.mg_decision) ? scene.mg_decision : null;
  if (!decision || decision.needed !== true) return "MG：不需要";
  const visible = isRecord(decision.visible_summary) ? decision.visible_summary : null;
  const label = stringValue(visible?.label) || stringValue(decision.chosen_template) || "MG";
  const statusLabel = stringValue(visible?.status_label) || "待渲染";
  return `MG：${label} · ${statusLabel}`;
}

// A product is in a failed generation state when its status carries the failure
// marker (mapper sets "生成失败 · 可重试" / mock uses "失败"). Real signal only.
function isFailedProduct(product: ProductArtifact): boolean {
  return /失败/.test(product.status) || product.phase === "失败";
}

function failureDetail(product: ProductArtifact): string {
  const metaError = isRecord(product.metadata) ? stringValue(product.metadata.error_message) : "";
  if (metaError) return metaError;
  const reasonSection = product.sections.find((section) => /失败|原因/.test(section.label));
  if (reasonSection) return `${reasonSection.title}。${reasonSection.detail}`.trim();
  return product.summary;
}

// Failure card reused across copy/image products (demo fail-card). Recovery
// runs through the conversation: retry re-submits a real instruction, adjust
// focuses the composer. No fabricated retry when nothing can be re-run.
function ProductFailureCard({ product }: { product: ProductArtifact }) {
  return (
    <div className="shadcn-prototype-video-failed" role="alert">
      <strong>生成失败</strong>
      <p>{failureDetail(product)}</p>
      <p className="shadcn-prototype-video-failed-note">你的素材、已确认的设定都已保留，重试会沿用当前方案重新生成。</p>
      <div className="shadcn-prototype-video-failed-actions">
        <button
          type="button"
          className="primary"
          onClick={() => window.dispatchEvent(new CustomEvent("multimix:composer-send", { detail: { utterance: "重试生成" } }))}
        >
          ↻ 重试生成
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("multimix:composer-focus"))}
        >
          回对话调整
        </button>
      </div>
    </div>
  );
}

// Remembers where each finished-video URL was last watched so reopening a
// product resumes instead of restarting from 0. Paired with backend media
// Cache-Control (backlog B), reopening the same clip is instant. Module scope
// = survives ProductPreview unmount/remount across product switches; bounded
// (one number per URL) so it cannot grow unbounded in a session.
const videoPlaybackPositions = new Map<string, number>();

function activeSegmentAtTime(segments: ProductArtifact["segments"], time: number): string | null {
  if (!segments?.length) return null;
  const active = segments.find((segment) => (
    segment.startSeconds != null
    && segment.endSeconds != null
    && time >= segment.startSeconds
    && time < segment.endSeconds
  ));
  return active?.id ?? segments.findLast((segment) => segment.startSeconds != null && time >= segment.startSeconds)?.id ?? null;
}

export default function ProductPreview({
  product,
  onReplaceMaterial,
}: {
  product: ProductArtifact;
  onReplaceMaterial?: (segment: AssetProductSegment) => void;
}) {
  // Hooks stay unconditional across the mode branches below.
  const browsePlayerRef = useRef<HTMLVideoElement | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState(PREVIEW_DEFAULT_HEIGHT);
  const [previewMax, setPreviewMax] = useState(() => (
    typeof window === "undefined" ? 640 : previewMaxHeight(window.innerHeight)
  ));
  const [fullVideoFailed, setFullVideoFailed] = useState(false);
  const exportedVideoUrl = playableVideoUrl(product);

  useEffect(() => {
    const updatePreviewMax = () => {
      const nextMax = previewMaxHeight(window.innerHeight);
      setPreviewMax(nextMax);
      setPreviewHeight((current) => clampPreviewHeight(current, PREVIEW_MIN_HEIGHT, nextMax));
    };
    window.addEventListener("resize", updatePreviewMax);
    return () => window.removeEventListener("resize", updatePreviewMax);
  }, []);

  useEffect(() => {
    setFullVideoFailed(false);
  }, [exportedVideoUrl]);

  if (product.mode === "copy") {
    if (isFailedProduct(product)) return <ProductFailureCard product={product} />;
    const markdown = product.markdownBody?.trim() || (product.body ?? [product.summary]).join("\n\n");
    return (
      <>
        <article className="shadcn-prototype-copy-document shadcn-prototype-markdown shadcn-prototype-stage-scroll-surface">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
            {markdown}
          </ReactMarkdown>
        </article>
        {product.sourceSummary ? <SourceRefBlock summary={product.sourceSummary} /> : null}
      </>
    );
  }

  if (product.mode === "image") {
    if (isFailedProduct(product)) return <ProductFailureCard product={product} />;
    // Hero image card + caption + source block (spec §5.6 / demo workspace-copy
    // 图片产物形态). Variant thumbnails come from preview.frames when present.
    const heroUrl = isRecord(product.metadata) ? stringValue(product.metadata.preview_url) || stringValue(product.metadata.thumbnail_url) : "";
    const caption = product.preview?.subtitle ?? product.summary;
    const variants = (product.preview?.frames ?? []).slice(1);
    return (
      <div className="shadcn-prototype-image-card" aria-label="图片产物预览">
        <div className="shadcn-prototype-image-card-hero">
          {/^https?:\/\//i.test(heroUrl) ? <img src={heroUrl} alt={product.preview?.title ?? product.title} loading="lazy" /> : <span>{product.ratio}</span>}
        </div>
        <div className="shadcn-prototype-image-card-caption">
          <strong>{product.preview?.title ?? product.title}</strong>
          <em>{caption}</em>
        </div>
        {variants.length ? (
          <div className="shadcn-prototype-image-card-variants" aria-label="其他方向">
            {variants.map((frame) => (
              <article key={`${frame.title}-${frame.subtitle}`} className={frame.tone ?? ""}>
                <span />
                <strong>{frame.title}</strong>
              </article>
            ))}
          </div>
        ) : null}
        {product.sourceSummary ? <SourceRefBlock summary={product.sourceSummary} /> : null}
      </div>
    );
  }

  if (product.mode === "audio") {
    return (
      <div className="shadcn-prototype-audio-preview" aria-label="音频产物预览">
        <div>
          <span>{product.duration}</span>
          <strong>{product.preview?.title ?? product.title}</strong>
          <em>{product.preview?.subtitle ?? "口播 / 字幕 / 时间轴已匹配"}</em>
        </div>
        <div className="shadcn-prototype-waveform" aria-hidden="true">
          {Array.from({ length: 34 }).map((_, index) => (
            <span key={index} style={{ "--bar-height": `${18 + (index % 7) * 7}px` } as CSSProperties} />
          ))}
        </div>
      </div>
    );
  }

  if (product.mode === "digital-human") {
    const videoUrl = playableVideoUrl(product);
    return (
      <div className="shadcn-prototype-digital-human-workspace" aria-label="数字人口播视频预览">
        <div className="shadcn-prototype-digital-human-preview">
          {videoUrl ? (
            <video
              className="shadcn-prototype-product-video-player"
              src={videoUrl}
              controls
              preload="metadata"
              playsInline
              aria-label="数字人口播视频"
            />
          ) : (
            <div className="shadcn-prototype-digital-stage">
              <div className="shadcn-prototype-digital-avatar" aria-hidden="true" />
              <div className="shadcn-prototype-digital-caption">
                <strong>{product.preview?.title ?? product.title}</strong>
                <span>{product.ratio} · {product.duration} · 渲染完成后可播放</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (product.mode === "mg_animation_video") {
    interface MGSceneParams {
      title: string;
      accentColor: string;
      entrance: string;
      [key: string]: unknown;
    }
    interface MGScene {
      template: string;
      durationInSeconds: number;
      layout: string;
      params: MGSceneParams;
    }
    const scene = product.metadata?.mg_scene as MGScene | undefined;
    const scenes = product.metadata?.mg_scenes as MGScene[] | undefined;
    const sceneList: MGScene[] = scenes ?? (scene ? [scene] : []);
    const isBatch = scenes != null && scenes.length > 1;

    return (
      <div className="shadcn-prototype-mg-preview" aria-label="MG 动效产物预览">
        {isBatch ? (
          <div className="shadcn-prototype-mg-batch-header">
            <span>{scenes!.length} 个 MG 动效方案</span>
          </div>
        ) : null}
        <div className="shadcn-prototype-mg-scenes">
          {sceneList.map((s, i) => (
            <div key={i} className="shadcn-prototype-mg-scene-card">
              <div className="shadcn-prototype-mg-scene-template">
                <strong>{s.template}</strong>
                <span>{s.layout} · {s.durationInSeconds}s</span>
              </div>
              <div className="shadcn-prototype-mg-scene-params">
                <span className="shadcn-prototype-mg-color-swatch" style={{ backgroundColor: s.params.accentColor }} />
                <span className="shadcn-prototype-mg-scene-title">{s.params.title}</span>
                <em>{s.params.entrance}</em>
              </div>
            </div>
          ))}
        </div>
        <div className="shadcn-prototype-mg-placeholder">
          <em>预览模式，接入渲染服务后可生成</em>
        </div>
      </div>
    );
  }

  const firstTimelineItems = product.timeline.slice(0, 3);
  const visualPreviewFrames = product.preview?.frames ?? [];
  const planSummary = videoPlanSummary(product);
  const planSummaryLabel = product.metadata?.video_project ? "视频工程摘要" : "编导稿摘要";
  const hasVideoProject = Boolean(product.videoProjectReady);
  const previewStageLabel = hasVideoProject ? "视频工程" : "编导稿草稿";
  const previewStageDescription = hasVideoProject
    ? "当前是可编辑视频工程，包含脚本、关键段落和素材匹配方向；可以继续在对话中调整分镜。"
    : "当前是可编辑编导稿，包含内容结构、关键段落和分镜方向；确认后可生成视频工程。";
  const previewPosterText = product.preview?.posterText ?? product.preview?.title ?? product.title;
  const gapNotice = materialGapNotice(product, planSummary?.materialUnfilledCount ?? planSummary?.materialGapCount ?? 0);
  // Demo-final browse state for any generated project (workspace-video.html
  // 默认态): centered 9:16 player + jumpable segment cards + source block.
  // With a real MP4 the player is playable; before export it shows the poster
  // skeleton (demo .screen) — never the legacy phone + meta-text layout.
  if (hasVideoProject) {
    const showFullVideo = Boolean(exportedVideoUrl && !fullVideoFailed);
    return (
      <div className="shadcn-prototype-video-browse shadcn-prototype-stage-scroll-surface" aria-label={showFullVideo ? "成片预览" : "分镜预览"}>
        <div className="shadcn-prototype-product-video" style={{ height: previewHeight }}>
          {showFullVideo ? (
            <VideoPreviewPlayer
              key={exportedVideoUrl}
              ref={browsePlayerRef}
              src={exportedVideoUrl}
              label="成片播放器"
              ratioClassName={getProductRatioClass(product.ratio)}
              initialTime={videoPlaybackPositions.get(exportedVideoUrl) ?? 0}
              onTimeUpdate={(time) => {
                videoPlaybackPositions.set(exportedVideoUrl, time);
                setActiveSegmentId(activeSegmentAtTime(product.segments, time));
              }}
              onError={() => setFullVideoFailed(true)}
            />
          ) : (
            <StoryboardPreview
              product={product}
              activeSegmentId={activeSegmentId ?? product.segments?.[0]?.id ?? null}
            />
          )}
        </div>
        {fullVideoFailed ? (
          <div className="shadcn-prototype-video-preview-fallback" role="alert">
            <span>成片加载失败，已切换到分镜预览。</span>
            <button type="button" onClick={() => setFullVideoFailed(false)}>重试成片</button>
          </div>
        ) : null}
        <VideoPreviewResizer
          value={previewHeight}
          min={PREVIEW_MIN_HEIGHT}
          max={previewMax}
          onChange={setPreviewHeight}
        />
        {product.segments?.length ? (
          <SegmentCards
            segments={product.segments}
            hint={showFullVideo ? "点击任意分镜可跳转成片" : "点击任意分镜可切换预览"}
            activeId={activeSegmentId ?? product.segments?.[0]?.id ?? null}
            onSelect={(segment) => {
              setActiveSegmentId(segment.id);
              const player = browsePlayerRef.current;
              if (showFullVideo && player && segment.startSeconds != null) {
                player.currentTime = segment.startSeconds;
                void player.play().catch(() => {});
              }
            }}
            onReplaceMaterial={onReplaceMaterial}
          />
        ) : null}
        {gapNotice ? <p className="shadcn-prototype-video-plan-gap">{gapNotice}</p> : null}
        {product.sourceSummary ? <SourceRefBlock summary={product.sourceSummary} /> : null}
      </div>
    );
  }

  return (
    <>
      {exportedVideoUrl ? (
        <div className="shadcn-prototype-product-video" aria-label="成片播放">
          <video
            className="shadcn-prototype-product-video-player"
            src={exportedVideoUrl}
            controls
            preload="metadata"
            playsInline
          />
        </div>
      ) : null}
      {!exportedVideoUrl ? (
        <section className="shadcn-prototype-video-placeholder-preview" aria-label={`${previewStageLabel}预览`}>
          <div className="shadcn-prototype-video-placeholder-phone" aria-hidden="true">
            <div className="shadcn-prototype-video-placeholder-screen">
              <span className="shadcn-prototype-video-placeholder-stage">{previewStageLabel}</span>
              <strong>{previewPosterText}</strong>
              <p>{product.preview?.subtitle ?? previewStageDescription}</p>
              <span className="shadcn-prototype-video-placeholder-play"><i /></span>
            </div>
            <div className="shadcn-prototype-video-placeholder-bar">
              <span>00:00</span>
              <i><b /></i>
              <span>{product.duration}</span>
            </div>
          </div>
          <div className="shadcn-prototype-video-placeholder-meta">
            <header>
              <span>{previewStageLabel}</span>
              <strong>{product.preview?.title ?? product.title}</strong>
              <em>{product.ratio} / {product.duration}</em>
            </header>
            <p>{previewStageDescription}</p>
            {firstTimelineItems.length ? (
              <ul>
                {firstTimelineItems.map((item) => (
                  <li key={`${item.time}-${item.title}`}>
                    <time>{item.time}</time>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}
      {planSummary ? (
        <section className="shadcn-prototype-video-plan-summary" aria-label={`${planSummaryLabel}摘要`}>
          <header>
            <span>{planSummaryLabel}</span>
            <strong>{planSummary.topic}</strong>
          </header>
          <div className="shadcn-prototype-video-plan-metrics">
            <span>{planSummary.audience}</span>
            <span>{planSummary.style}</span>
            <span>MG 风格：{planSummary.mgStyle}</span>
            <span>{planSummary.duration}</span>
            <span>{planSummary.sceneCount} 个分镜</span>
            <span>已匹配 {planSummary.materialHitCount} 个素材</span>
            {planSummary.publicMaterialFillCount ? <span>自动补 {planSummary.publicMaterialFillCount} 个公共素材</span> : null}
            {planSummary.materialGapCount ? <span>{planSummary.materialGapCount} 个分镜自动补素材</span> : null}
            {planSummary.mgNeededCount ? <span>{planSummary.mgNeededCount} 个分镜自动加 MG</span> : null}
            {planSummary.mgRenderedCount ? <span>{planSummary.mgRenderedCount} 个 MG 已渲染</span> : null}
            {planSummary.mgFailedCount ? <span>{planSummary.mgFailedCount} 个 MG 渲染失败</span> : null}
          </div>
          {gapNotice ? <p className="shadcn-prototype-video-plan-gap">{gapNotice}</p> : null}
          {planSummary.scenes.length && !product.segments?.length ? (
            <details>
              <summary>查看分镜详情</summary>
              <ol>
                {planSummary.scenes.slice(0, 8).map((scene, index) => (
                  <li key={stringValue(scene.id) || index}>
                    <strong>{stringValue(scene.title) || `分镜 ${index + 1}`}</strong>
                    <span>{stringValue(scene.subtitle_focus) || stringValue(scene.narration)}</span>
                    <em>{sceneAssetReferenceSummary(scene)}</em>
                    <em>{sceneMgDecisionSummary(scene)}</em>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}
      {product.segments?.length ? <SegmentCards segments={product.segments} /> : null}

      {visualPreviewFrames.length ? (
        <div className="shadcn-prototype-image-strip" aria-label="视觉预览">
          {visualPreviewFrames.map((frame) => (
            <article key={`${frame.title}-${frame.subtitle}`} className={frame.tone ?? ""}>
              <span />
              <strong>{frame.title}</strong>
            </article>
          ))}
        </div>
      ) : null}

      {product.sourceSummary ? <SourceRefBlock summary={product.sourceSummary} /> : null}
    </>
  );
}
