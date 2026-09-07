"use client";

import { useState } from "react";
import { API_BASE } from "../../../lib/api";
import type { AssetImageGenerationTarget } from "../lib/asset-workspace-types";

type Finding = { status: string; evidence: string };
export type GeneratedImageFrame = { frame_id: string; intent: string; storage_ref: string; asset_id?: number; review_status?: string;
  quality_review?: { status?: string; checks?: Record<string, Finding> } };
const CHECK_LABELS: Record<string, string> = { structure: "结构", quantity: "数量", color: "颜色",
  text_marks: "文字与印记", shot: "镜头表达", diversity: "相邻帧丰富性" };
const REVIEW_LABELS: Record<string, string> = { no_issue_detected: "可选择 · 仍需人工检查",
  flagged: "需调整", needs_review: "需调整", unreviewed: "待人工检查" };

export function reviewLabel(frame: GeneratedImageFrame) {
  return REVIEW_LABELS[frame.review_status ?? ""] ?? REVIEW_LABELS.unreviewed;
}

function framesFrom(value: unknown): GeneratedImageFrame[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is GeneratedImageFrame => Boolean(v && typeof v === "object"
    && typeof v.frame_id === "string" && typeof v.intent === "string"
    && typeof v.storage_ref === "string"
    && /^(?:local|supabase|s3):\/\/(?:[^/]+\/)?content-assets\/\d+\/generation-jobs\/\d+\/images\/[a-f0-9]{64}\.png$/.test(v.storage_ref)));
}

function mediaUrl(ref: string) {
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
}

function reviewFindings(frame: GeneratedImageFrame) {
  return Object.entries(frame.quality_review?.checks ?? {}).filter(([key, finding]) => (
    CHECK_LABELS[key] && finding && typeof finding.evidence === "string"
    && ["mismatch", "uncertain"].includes(finding.status)
  ));
}

export function GeneratedImageKeyframeGroup({
  images,
  title,
  selectedFrameId,
  onSelectedFrameChange,
}: {
  images: unknown;
  title: string;
  selectedFrameId?: string;
  onSelectedFrameChange: (frameId: string) => void;
}) {
  const frames = framesFrom(images);
  if (!frames.length) return null;
  const selected = frames.find((frame) => frame.frame_id === selectedFrameId) ?? frames[0];
  const needsReview = frames.filter((frame) => reviewFindings(frame).length > 0).length;
  return (
    <section className="shadcn-prototype-inline-image-keyframe-group" aria-label={`${title}关键帧组`}>
      <header>
        <div>
          <strong>{title}</strong>
          <em>{frames.length} 张关键帧 · 当前 {selected.frame_id}</em>
        </div>
        <span className={needsReview ? "needs-review" : "ready"}>
          {needsReview ? `${needsReview} 张待确认` : "均待人工确认"}
        </span>
      </header>
      <div className="shadcn-prototype-inline-image-keyframe-list">
        {frames.map((frame) => (
          <button
            key={frame.frame_id}
            type="button"
            aria-label={`查看 ${frame.frame_id} ${frame.intent}`}
            aria-pressed={frame.frame_id === selected.frame_id}
            onClick={() => onSelectedFrameChange(frame.frame_id)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated generated media */}
            <img src={mediaUrl(frame.storage_ref)} alt={`${frame.frame_id} ${frame.intent}`} loading="lazy" />
            <strong>{frame.frame_id}</strong>
            <span className={reviewFindings(frame).length ? "needs-review" : "ready"}>
              {reviewFindings(frame).length ? "需确认" : "待人工检查"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export type GeneratedImageGalleryApplication = {
  candidateAssetId: number;
  candidateSetHash: string;
  target: AssetImageGenerationTarget;
};

export type GeneratedImageGallerySetApplication = {
  candidateSetHash: string;
  target: AssetImageGenerationTarget;
  assignments: Array<{ candidateAssetId: number; sceneId: string }>;
};

export default function GeneratedImageGallery({
  images,
  candidateAssetId,
  candidateSetHash,
  target,
  applied = false,
  onApply,
  onApplySet,
  selectedFrameId,
  onSelectedFrameChange,
}: {
  images: unknown;
  candidateAssetId?: number;
  candidateSetHash?: string;
  target?: AssetImageGenerationTarget;
  applied?: boolean;
  onApply?: (application: GeneratedImageGalleryApplication) => Promise<void> | void;
  onApplySet?: (application: GeneratedImageGallerySetApplication) => Promise<void> | void;
  selectedFrameId?: string;
  onSelectedFrameChange?: (frameId: string) => void;
}) {
  const frames = framesFrom(images);
  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [isApplyingSet, setIsApplyingSet] = useState(false);
  const [locallyApplied, setLocallyApplied] = useState(applied);
  const selectedId = selectedFrameId ?? uncontrolledSelectedId;
  const selected = frames.find((f) => f.frame_id === selectedId) ?? frames[0];
  const selectFrame = (frameId: string) => {
    if (selectedFrameId == null) setUncontrolledSelectedId(frameId);
    onSelectedFrameChange?.(frameId);
  };
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
  const keyframeSetAssignments = target?.kind === "director_scene"
    && target.sceneIds?.length === frames.length
    && frames.length > 1
    && frames.every((frame) => typeof frame.asset_id === "number" && frame.asset_id > 0)
    ? frames.map((frame, index) => ({
        candidateAssetId: frame.asset_id as number,
        sceneId: target.sceneIds![index],
      }))
    : null;
  const canApplySet = Boolean(
    onApplySet
    && candidateSetHash
    && target?.assetId
    && target.versionId
    && keyframeSetAssignments,
  );
  if (!selected) return <p>图片暂不可读取。</p>;
  const findings = reviewFindings(selected);
  return <section className="shadcn-prototype-image-card shadcn-prototype-generated-image-review" aria-label="生成图片集">
    <div className="shadcn-prototype-generated-image-main">
      <div className="shadcn-prototype-image-card-hero">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated generated media */}
      <img src={mediaUrl(selected.storage_ref)} alt={`${selected.frame_id} ${selected.intent} 大图`} />
      </div>
      <div className="shadcn-prototype-image-card-caption">
        <strong>{selected.frame_id} · {selected.intent}</strong>
        <em>{frames.length} 张图片 · {reviewLabel(selected)}</em>
        <a href={mediaUrl(selected.storage_ref)} target="_blank" rel="noreferrer">打开原图</a>
      </div>
      {target?.kind === "project" ? <p>已保存到图片库</p> : null}
      {target?.kind === "video_scene" ? <p>已保存到图片库；已有视频分镜的应用将在视频编辑中单独确认。</p> : null}
      {actionableTarget ? (
        <div className="shadcn-prototype-generated-image-actions">
        {locallyApplied ? <span>已应用</span> : <span>尚未应用到分镜</span>}
        {canApplySet ? (
          <>
            <p>将按当前顺序分别写入目标分镜；这不会自动生成视频。</p>
            <button
              type="button"
              disabled={isApplyingSet || locallyApplied}
              onClick={async () => {
                if (!candidateSetHash || !target || !keyframeSetAssignments) return;
                setIsApplyingSet(true);
                try {
                  await onApplySet?.({ candidateSetHash, target, assignments: keyframeSetAssignments });
                  setLocallyApplied(true);
                } finally {
                  setIsApplyingSet(false);
                }
              }}
            >
              {locallyApplied
                ? "已应用"
                : isApplyingSet
                  ? "正在应用…"
                  : `将 ${frames.length} 张分别用于 ${target?.sceneIds?.length ?? 0} 个分镜`}
            </button>
          </>
        ) : canApply ? (
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
      <div className="shadcn-prototype-generated-image-thumbnails">
      {frames.map((frame) => <button key={frame.frame_id} type="button"
        aria-label={`查看 ${frame.frame_id} ${frame.intent}`} aria-pressed={frame.frame_id === selected.frame_id}
        onClick={() => selectFrame(frame.frame_id)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated generated media */}
        <img src={mediaUrl(frame.storage_ref)} alt={frame.frame_id} loading="lazy"
          style={{ width: 100, height: 100, objectFit: "contain" }} />
        <span>{frame.frame_id} · {reviewLabel(frame).split(" · ")[0]}</span>
      </button>)}
      </div>
    </div>
    <aside className="shadcn-prototype-generated-image-review-rail" aria-label="图片检查结果">
      <header>
        <strong>审核结果</strong>
        <span className={findings.length ? "needs-review" : "ready"}>{findings.length ? "需确认" : "未发现关键差异"}</span>
      </header>
      <p>{selected.frame_id} · {selected.intent}</p>
      <small>AI 检查可能漏检，使用前仍需人工确认商品细节。</small>
      {findings.length ? (
        <ul>{findings.slice(0, 3).map(([key, finding]) => (
          <li key={key}>{CHECK_LABELS[key]}：{finding.evidence}</li>
        ))}</ul>
      ) : <div className="shadcn-prototype-generated-image-review-clear">未发现关键差异，仍建议人工确认。</div>}
    </aside>
  </section>;
}
