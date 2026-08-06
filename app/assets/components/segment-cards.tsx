"use client";

import type { AssetProductSegment } from "../lib/asset-workspace-types";

function segmentRange(segment: AssetProductSegment): string | null {
  if (segment.startSeconds == null || segment.endSeconds == null) return null;
  return `${Math.round(segment.startSeconds)}–${Math.round(segment.endSeconds)}s`;
}

export function segmentNeedsMaterial(segment: AssetProductSegment): boolean {
  return segment.primaryVisualSourceType !== "generated_scene"
    && Boolean(segment.isFallback)
    && !segment.assetTitle
    && !segment.assetThumbnailUrl;
}

// Pure display list for storyboard segment summaries (序号/时长/标题/口播/
// 必要异常状态). Callers only render it when segment data exists. When
// onSelect is wired (成片浏览态) the cards double as jump-to-preview targets.
export default function SegmentCards({
  segments,
  activeId,
  onSelect,
  onReplaceMaterial,
  onEditVoiceover,
}: {
  segments: AssetProductSegment[];
  activeId?: string | null;
  onSelect?: (segment: AssetProductSegment) => void;
  onReplaceMaterial?: (segment: AssetProductSegment) => void;
  onEditVoiceover?: (segment: AssetProductSegment) => void;
}) {
  if (segments.length === 0) return null;
  return (
    <section className="shadcn-prototype-segment-cards" aria-label="分镜摘要">
      <header>
        <span>分镜 · {segments.length} 段</span>
      </header>
      <ol>
        {segments.map((segment) => {
          const range = segmentRange(segment);
          const selectable = Boolean(onSelect);
          const mgStatus = segment.mgStatus === "failed" ? "渲染失败" : null;
          const needsMaterial = segmentNeedsMaterial(segment);
          const primaryCopy = segment.title || segment.line || `分镜 ${segment.index}`;
          const secondaryCopy = mgStatus && segment.subLine
            ? segment.subLine
            : segment.title
              ? segment.line || segment.subLine || segment.assetTitle
              : segment.subLine || segment.assetTitle;
          return (
            <li
              key={segment.id}
              className={[
                segment.id === activeId ? "active" : "",
                selectable ? "clickable" : ""
              ].filter(Boolean).join(" ") || undefined}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              onClick={selectable ? () => onSelect?.(segment) : undefined}
              onKeyDown={selectable ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.(segment);
                }
              } : undefined}
            >
              <span className="shadcn-prototype-segment-no">
                <b>#{segment.index}</b>
                {range ? <span>{range}</span> : null}
              </span>
              <span className={`shadcn-prototype-segment-thumb${needsMaterial ? " needs-material" : ""}`} aria-hidden={segment.assetThumbnailUrl ? undefined : true}>
                {segment.assetThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- dynamic blob:/remote thumbnail URLs are unsupported by next/image
                  <img src={segment.assetThumbnailUrl} alt="" loading="lazy" />
                ) : segment.primaryVisualMediaType === "video" ? (
                  <span className="shadcn-prototype-segment-video-placeholder">视频</span>
                ) : null}
              </span>
              <span className="shadcn-prototype-segment-copy">
                <span className="shadcn-prototype-segment-line1">
                  <strong>{primaryCopy}</strong>
                  {segment.mgLabel ? <i className="shadcn-prototype-segment-mg">{segment.mgLabel}</i> : null}
                  {segment.visualStatusLabel ? <i className="shadcn-prototype-segment-mg">{segment.visualStatusLabel}</i> : null}
                  {mgStatus ? <i className={`shadcn-prototype-segment-mg-status ${segment.mgStatus ?? ""}`}>{mgStatus}</i> : null}
                  {needsMaterial ? <i className="shadcn-prototype-segment-material-needed">待补素材</i> : null}
                </span>
                {secondaryCopy ? (
                  <span className="shadcn-prototype-segment-line2">
                    {secondaryCopy}
                  </span>
                ) : null}
                {segment.businessHint ? (
                  <span className="shadcn-prototype-segment-line2">
                    {segment.businessHint}
                  </span>
                ) : null}
                {segment.visualTreatmentLabel ? (
                  <span className="shadcn-prototype-segment-line2">
                    呈现方式：{segment.visualTreatmentLabel}
                    {segment.graphicComponentLabel ? ` · ${segment.graphicComponentLabel}` : ""}
                  </span>
                ) : null}
                {segment.selectionReason ? (
                  <span className="shadcn-prototype-segment-line2">
                    选择理由：{segment.selectionReason}
                  </span>
                ) : null}
                {segment.backgroundTreatmentLabel ? (
                  <span className="shadcn-prototype-segment-line2">
                    背景：{segment.backgroundTreatmentLabel}
                  </span>
                ) : null}
                {segment.publicReplacementNote ? (
                  <span className="shadcn-prototype-segment-line2">
                    {segment.publicReplacementNote}
                  </span>
                ) : null}
              </span>
              {onReplaceMaterial || onEditVoiceover ? (
                <span className="shadcn-prototype-segment-actions">
                  {onEditVoiceover ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEditVoiceover(segment);
                      }}
                    >
                      修改配音
                    </button>
                  ) : null}
                  {onReplaceMaterial ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onReplaceMaterial(segment);
                      }}
                    >
                      换素材
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
