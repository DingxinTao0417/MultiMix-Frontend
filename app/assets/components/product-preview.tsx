"use client";

import { type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { API_BASE } from "../../../lib/api";
import { isRecord, stringValue, type ProductArtifact } from "../lib/asset-workspace-shared";

// Resolve a directly playable URL for a video-like product: exported MP4s live
// behind the backend media proxy (store refs), external sources pass through.
function playableVideoUrl(product: ProductArtifact): string {
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
  return {
    topic: stringValue(summary.topic) || product.title,
    audience: stringValue(plan.audience) || "潜在用户",
    style: stringValue(plan.style) || "清晰可信",
    duration: typeof plan.duration_seconds === "number" ? `${plan.duration_seconds}秒` : product.duration,
    sceneCount: typeof summary.scene_count === "number" ? summary.scene_count : scenes.length,
    materialHitCount: typeof summary.material_hit_count === "number" ? summary.material_hit_count : 0,
    publicMaterialFillCount: typeof summary.public_material_fill_count === "number" ? summary.public_material_fill_count : 0,
    materialGapCount: typeof summary.material_gap_count === "number" ? summary.material_gap_count : 0,
    materialUnfilledCount: typeof summary.material_unfilled_count === "number" ? summary.material_unfilled_count : 0,
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

export default function ProductPreview({ product }: { product: ProductArtifact }) {
  if (product.mode === "copy") {
    const markdown = product.markdownBody?.trim() || (product.body ?? [product.summary]).join("\n\n");
    return (
      <article className="shadcn-prototype-copy-document shadcn-prototype-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {markdown}
        </ReactMarkdown>
      </article>
    );
  }

  if (product.mode === "image") {
    const frames = product.preview?.frames ?? [
      { title: "主封面", subtitle: "白色商务" },
      { title: "信息图", subtitle: "数据标签" },
      { title: "客户场景", subtitle: "咨询画面" }
    ];
    return (
      <div className="shadcn-prototype-image-preview" aria-label="图片产物预览">
        <div className="shadcn-prototype-image-main">
          <span>4:5</span>
          <strong>{product.preview?.title ?? product.title}</strong>
          <em>{product.preview?.subtitle ?? product.summary}</em>
        </div>
        <div className="shadcn-prototype-image-variants">
          {frames.map((frame) => (
            <article key={`${frame.title}-${frame.subtitle}`} className={frame.tone ?? ""}>
              <span />
              <strong>{frame.title}</strong>
            </article>
          ))}
        </div>
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
  const planSummaryLabel = product.metadata?.video_project ? "视频工程摘要" : "视频文案草稿";
  const gapNotice = materialGapNotice(product, planSummary?.materialUnfilledCount ?? planSummary?.materialGapCount ?? 0);
  const exportedVideoUrl = playableVideoUrl(product);
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
      {planSummary ? (
        <section className="shadcn-prototype-video-plan-summary" aria-label={`${planSummaryLabel}摘要`}>
          <header>
            <span>{planSummaryLabel}</span>
            <strong>{planSummary.topic}</strong>
          </header>
          <div className="shadcn-prototype-video-plan-metrics">
            <span>{planSummary.audience}</span>
            <span>{planSummary.style}</span>
            <span>{planSummary.duration}</span>
            <span>{planSummary.sceneCount} 个分镜</span>
            <span>已匹配 {planSummary.materialHitCount} 个素材</span>
            {planSummary.publicMaterialFillCount ? <span>自动补 {planSummary.publicMaterialFillCount} 个公共素材</span> : null}
            {planSummary.materialGapCount ? <span>{planSummary.materialGapCount} 个分镜自动补素材</span> : null}
          </div>
          {gapNotice ? <p className="shadcn-prototype-video-plan-gap">{gapNotice}</p> : null}
          {planSummary.scenes.length ? (
            <details>
              <summary>查看分镜详情</summary>
              <ol>
                {planSummary.scenes.slice(0, 8).map((scene, index) => (
                  <li key={stringValue(scene.id) || index}>
                    <strong>{stringValue(scene.title) || `分镜 ${index + 1}`}</strong>
                    <span>{stringValue(scene.subtitle_focus) || stringValue(scene.narration)}</span>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}
      <div className="shadcn-prototype-video-frame project">
        <article className="shadcn-prototype-video-project-card" aria-label="视频工程预览">
          <header>
            <span>视频工程</span>
            <em>{product.ratio} / {product.duration}</em>
          </header>
          <div>
            <strong>{product.preview?.title ?? product.title}</strong>
            <p>当前是可编辑视频工程，包含脚本、关键段落和素材匹配方向；可以继续在对话中调整分镜。</p>
          </div>
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
        </article>
      </div>

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
    </>
  );
}
