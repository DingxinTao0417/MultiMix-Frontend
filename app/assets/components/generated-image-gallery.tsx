"use client";

import { useState } from "react";
import { API_BASE } from "../../../lib/api";
import type { AssetImageGenerationTarget } from "../lib/asset-workspace-types";

type Finding = { status: string; evidence: string };
type Frame = { frame_id: string; intent: string; storage_ref: string; review_status?: string;
  quality_review?: { status?: string; checks?: Record<string, Finding> } };
const CHECK_LABELS: Record<string, string> = { structure: "结构", quantity: "数量", color: "颜色",
  text_marks: "文字与印记", shot: "镜头表达", diversity: "相邻帧丰富性" };
const REVIEW_LABELS: Record<string, string> = { no_issue_detected: "AI 初检未见明显问题",
  flagged: "发现问题", needs_review: "待人工复核", unreviewed: "未完成检查 · 待检查商品细节" };

function reviewLabel(frame: Frame) {
  return REVIEW_LABELS[frame.review_status ?? ""] ?? REVIEW_LABELS.unreviewed;
}

function framesFrom(value: unknown): Frame[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Frame => Boolean(v && typeof v === "object"
    && typeof v.frame_id === "string" && typeof v.intent === "string"
    && typeof v.storage_ref === "string"
    && /^(?:local|supabase|s3):\/\/(?:[^/]+\/)?content-assets\/\d+\/generation-jobs\/\d+\/images\/[a-f0-9]{64}\.png$/.test(v.storage_ref)));
}

function mediaUrl(ref: string) {
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
}

export type GeneratedImageGalleryApplication = {
  candidateAssetId: number;
  candidateSetHash: string;
  target: AssetImageGenerationTarget;
};

export default function GeneratedImageGallery({
  images,
  candidateAssetId,
  candidateSetHash,
  target,
  applied = false,
  onApply,
}: {
  images: unknown;
  candidateAssetId?: number;
  candidateSetHash?: string;
  target?: AssetImageGenerationTarget;
  applied?: boolean;
  onApply?: (application: GeneratedImageGalleryApplication) => Promise<void> | void;
}) {
  const frames = framesFrom(images);
  const [selectedId, setSelectedId] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [locallyApplied, setLocallyApplied] = useState(applied);
  const selected = frames.find((f) => f.frame_id === selectedId) ?? frames[0];
  const actionableTarget = target?.kind === "cover" || target?.kind === "director_scene";
  const canApply = Boolean(
    onApply
    && candidateAssetId
    && candidateSetHash
    && actionableTarget
    && target?.assetId
    && target.versionId,
  );
  const actionLabel = target?.kind === "cover" ? "设为封面" : "应用到分镜";
  if (!selected) return <p>图片暂不可读取。</p>;
  return <section className="shadcn-prototype-image-card" aria-label="生成图片集">
    <div className="shadcn-prototype-image-card-hero">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated generated media */}
      <img src={mediaUrl(selected.storage_ref)} alt={`${selected.frame_id} ${selected.intent} 大图`} />
    </div>
    <div className="shadcn-prototype-image-card-caption">
      <strong>{selected.frame_id} · {selected.intent}</strong>
      <em>{frames.length} 张图片 · {reviewLabel(selected)}</em>
      <a href={mediaUrl(selected.storage_ref)} target="_blank" rel="noreferrer">打开原图</a>
    </div>
    <div aria-label="图片检查结果" style={{ padding: "8px 12px" }}>
      <p>AI 检查可能漏检，使用前仍需人工确认商品细节。</p>
      <ul>{Object.entries(selected.quality_review?.checks ?? {}).filter(([key, finding]) =>
        CHECK_LABELS[key] && finding && typeof finding.evidence === "string"
        && ["mismatch", "uncertain"].includes(finding.status)).map(([key, finding]) =>
        <li key={key}>{CHECK_LABELS[key]}：{finding.evidence}</li>)}</ul>
    </div>
    {target?.kind === "project" ? <p style={{ padding: "0 12px" }}>已保存到图片库</p> : null}
    {target?.kind === "video_scene" ? <p style={{ padding: "0 12px" }}>已保存到图片库；已有视频分镜的应用将在视频编辑中单独确认。</p> : null}
    {actionableTarget ? (
      <div style={{ padding: "0 12px 8px" }}>
        {locallyApplied ? <span>已应用</span> : <span>尚未应用到分镜</span>}
        {canApply ? (
          <button
            type="button"
            disabled={isApplying || locallyApplied}
            onClick={async () => {
              if (!candidateAssetId || !candidateSetHash || !target) return;
              setIsApplying(true);
              try {
                await onApply?.({ candidateAssetId, candidateSetHash, target });
                setLocallyApplied(true);
              } finally {
                setIsApplying(false);
              }
            }}
          >
            {locallyApplied ? "已应用" : isApplying ? "正在应用…" : actionLabel}
          </button>
        ) : null}
      </div>
    ) : null}
    <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: 12 }}>
      {frames.map((frame) => <button key={frame.frame_id} type="button"
        aria-label={`查看 ${frame.frame_id} ${frame.intent}`} aria-pressed={frame.frame_id === selected.frame_id}
        onClick={() => setSelectedId(frame.frame_id)} style={{ flex: "0 0 100px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated generated media */}
        <img src={mediaUrl(frame.storage_ref)} alt={frame.frame_id} loading="lazy"
          style={{ width: 100, height: 100, objectFit: "contain" }} />
        <span>{frame.frame_id} · {reviewLabel(frame).split(" · ")[0]}</span>
      </button>)}
    </div>
  </section>;
}
