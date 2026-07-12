"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../../lib/api";
import { getProductRatioClass, isRecord, stringValue, type ProductArtifact } from "../lib/asset-workspace-shared";
import VideoPreviewPlayer from "./video-preview-player";

type SegmentMedia = {
  kind: "image" | "video";
  src: string;
};

export function mediaUrlForRef(ref: string): string {
  if (!ref) return "";
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
}

export function findMediaForSegment(
  product: ProductArtifact,
  activeSegmentId: string | null,
): SegmentMedia | null {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  const project = isRecord(metadata.video_project) ? metadata.video_project : null;
  const timeline = project && isRecord(project.timeline) ? project.timeline : project;
  const tracks = timeline && Array.isArray(timeline.tracks) ? timeline.tracks.filter(isRecord) : [];
  const media = timeline && Array.isArray(timeline.media) ? timeline.media.filter(isRecord) : [];
  const segmentId = activeSegmentId || product.segments?.[0]?.id || "";

  for (const track of tracks) {
    if (!Array.isArray(track.elements) || track.overlay === true) continue;
    const element = track.elements
      .filter(isRecord)
      .find((item) => stringValue(item.segmentId) === segmentId && ["image", "video"].includes(stringValue(item.type)));
    if (!element) continue;
    const mediaId = stringValue(element.mediaId);
    const item = media.find((candidate) => stringValue(candidate.id) === mediaId);
    const ref = stringValue(item?.file_path);
    const kind = stringValue(item?.type);
    if (ref && (kind === "image" || kind === "video")) {
      return { kind, src: mediaUrlForRef(ref) };
    }
  }

  const segment = product.segments?.find((item) => item.id === segmentId) ?? product.segments?.[0];
  return segment?.assetThumbnailUrl
    ? { kind: "image", src: segment.assetThumbnailUrl }
    : null;
}

export default function StoryboardPreview({
  product,
  activeSegmentId,
}: {
  product: ProductArtifact;
  activeSegmentId: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const currentSegmentMedia = useMemo(
    () => findMediaForSegment(product, activeSegmentId),
    [activeSegmentId, product],
  );
  const segment = product.segments?.find((item) => item.id === activeSegmentId) ?? product.segments?.[0];

  useEffect(() => {
    setFailed(false);
  }, [currentSegmentMedia?.src]);

  return (
    <div className={`shadcn-prototype-project-preview ${getProductRatioClass(product.ratio)}`.trim()} aria-label="轻量分镜预览">
      <span className="shadcn-prototype-preview-mode-label">分镜预览 · #{segment?.index ?? 1}</span>
      <div className="shadcn-prototype-project-preview-screen">
        {!failed && currentSegmentMedia?.kind === "video" ? (
          <VideoPreviewPlayer
            key={currentSegmentMedia.src}
            src={currentSegmentMedia.src}
            label={`分镜 #${segment?.index ?? 1} 视频`}
            ratioClassName={getProductRatioClass(product.ratio)}
            onError={() => setFailed(true)}
          />
        ) : null}
        {!failed && currentSegmentMedia?.kind === "image" ? (
          <img
            key={currentSegmentMedia.src}
            src={currentSegmentMedia.src}
            alt={segment?.assetTitle || segment?.title || `分镜 ${segment?.index ?? 1}`}
            onError={() => setFailed(true)}
          />
        ) : null}
        {failed || !currentSegmentMedia ? (
          <div className="shadcn-prototype-video-placeholder-screen" role={failed ? "alert" : undefined}>
            <span className="shadcn-prototype-video-placeholder-stage">分镜 {segment?.index ?? 1}</span>
            <strong>{failed ? (segment?.title || segment?.assetTitle || "分镜预览") : "待补素材"}</strong>
            <p>{failed ? "该分镜预览暂不可用" : segment?.line || "该分镜暂无可预览素材"}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
