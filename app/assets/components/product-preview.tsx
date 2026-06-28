"use client";

import { type CSSProperties } from "react";
import { Play } from "lucide-react";
import type { ProductArtifact } from "../lib/asset-workspace-shared";

export default function ProductPreview({ product }: { product: ProductArtifact }) {
  if (product.mode === "copy") {
    return (
      <article className="shadcn-prototype-copy-document" contentEditable suppressContentEditableWarning>
        <h3>{product.title}</h3>
        {(product.body ?? [product.summary]).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
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
    return (
      <div className="shadcn-prototype-digital-human-workspace" aria-label="数字人口播视频预览">
        <div className="shadcn-prototype-digital-human-preview">
          <div className="shadcn-prototype-digital-stage">
            <div className="shadcn-prototype-digital-avatar" aria-hidden="true" />
            <div className="shadcn-prototype-digital-caption">
              <strong>{product.preview?.title ?? product.title}</strong>
              <span>{product.ratio} · {product.duration}</span>
            </div>
            <button type="button" aria-label="播放数字人口播预览">
              <Play size={18} fill="currentColor" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const firstTimelineItems = product.timeline.slice(0, 3);
  const visualPreviewFrames = product.preview?.frames ?? [];
  return (
    <>
      <div className="shadcn-prototype-video-frame project">
        <article className="shadcn-prototype-video-project-card" aria-label="视频工程预览">
          <header>
            <span>视频工程</span>
            <em>{product.ratio} / {product.duration}</em>
          </header>
          <div>
            <strong>{product.preview?.title ?? product.title}</strong>
            <p>当前是可编辑视频工程，包含脚本、关键段落和素材匹配方向；确认后再生成成片。</p>
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
