"use client";

import type { AssetProductSegment } from "../lib/asset-workspace-types";

function segmentRange(segment: AssetProductSegment): string | null {
  if (segment.startSeconds == null || segment.endSeconds == null) return null;
  return `${Math.round(segment.startSeconds)}–${Math.round(segment.endSeconds)}s`;
}

// Pure display list for storyboard segment summaries (序号/时长/台词/素材引用/
// MG 徽章/兜底标注). Callers only render it when segment data exists.
export default function SegmentCards({ segments }: { segments: AssetProductSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <section className="shadcn-prototype-segment-cards" aria-label="分镜摘要">
      <header>分镜 · {segments.length} 段</header>
      <ol>
        {segments.map((segment) => {
          const range = segmentRange(segment);
          return (
            <li key={segment.id}>
              <span className="shadcn-prototype-segment-no">
                <b>#{segment.index}</b>
                {range ? <span>{range}</span> : null}
              </span>
              <span className={`shadcn-prototype-segment-thumb${segment.isFallback ? " is-fallback" : ""}`} aria-hidden={segment.assetThumbnailUrl ? undefined : true}>
                {segment.assetThumbnailUrl ? <img src={segment.assetThumbnailUrl} alt="" loading="lazy" /> : null}
              </span>
              <span className="shadcn-prototype-segment-copy">
                <span className="shadcn-prototype-segment-line1">
                  <strong>{[segment.title, segment.line].filter(Boolean).join(" · ") || `分镜 ${segment.index}`}</strong>
                  {segment.mgLabel ? <i className="shadcn-prototype-segment-mg">{segment.mgLabel}</i> : null}
                  {segment.isFallback ? <i className="shadcn-prototype-segment-stock">兜底素材</i> : null}
                </span>
                {segment.assetTitle || segment.subLine ? (
                  <span className="shadcn-prototype-segment-line2">
                    {[segment.assetTitle, segment.subLine].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
