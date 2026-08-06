"use client";

import { useState } from "react";
import type { AssetProductSourceSummary } from "../lib/asset-workspace-types";

export type GenerationAnimationSummary = {
  mode: string;
  metrics: string[];
};

function SourceThumbnail({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  if (failed) {
    return <span className="shadcn-prototype-source-unavailable">原文件不可用</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- dynamic blob:/remote thumbnail URLs are unsupported by next/image
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}

// Pure display block for product-level source references (understanding
// status + reference counts). Callers only render it when real summary data
// exists — never with placeholder sources.
export default function SourceRefBlock({
  summary,
  animation,
}: {
  summary?: AssetProductSourceSummary;
  animation?: GenerationAnimationSummary;
}) {
  if ((!summary?.headline && !summary?.refs.length) && !animation?.mode) return null;
  return (
    <details className="shadcn-prototype-source-block" aria-label="来源引用">
      <summary>
        <span className="shadcn-prototype-source-dot" aria-hidden="true" />
        <strong>{summary?.headline || "动画编排说明"}</strong>
      </summary>
      <div className="shadcn-prototype-source-content">
        {animation?.mode ? (
          <div className="shadcn-prototype-source-metrics" aria-label="动画编排信息">
            <span>动画编排：{animation.mode}</span>
            {animation.metrics.map((metric) => <span key={metric}>{metric}</span>)}
          </div>
        ) : null}
        {summary?.refs.length ? (
          <ul>
            {summary.refs.map((ref) => (
              <li key={ref.id} className={ref.isFallback ? "is-fallback" : undefined}>
                <span className="shadcn-prototype-source-thumb" aria-hidden={ref.thumbnailUrl ? undefined : true}>
                  <SourceThumbnail url={ref.thumbnailUrl} />
                </span>
                <span className="shadcn-prototype-source-copy">
                  <strong>{ref.title}</strong>
                  {ref.isFallback || ref.statusLabel || ref.referenceCount != null ? (
                    <em>
                      {[
                        ref.isFallback ? "公共素材" : ref.statusLabel,
                        ref.referenceCount != null ? `被引用 ${ref.referenceCount} 次` : ""
                      ].filter(Boolean).join(" · ")}
                    </em>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {summary?.note ? <p>{summary.note}</p> : null}
      </div>
    </details>
  );
}
