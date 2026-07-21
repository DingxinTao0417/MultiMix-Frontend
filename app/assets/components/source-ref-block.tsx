"use client";

import type { AssetProductSourceSummary } from "../lib/asset-workspace-types";

// Pure display block for product-level source references (understanding
// status + reference counts). Callers only render it when real summary data
// exists — never with placeholder sources.
export default function SourceRefBlock({ summary }: { summary: AssetProductSourceSummary }) {
  if (!summary.headline && summary.refs.length === 0) return null;
  return (
    <section className="shadcn-prototype-source-block" aria-label="来源引用">
      <header>
        <span className="shadcn-prototype-source-dot" aria-hidden="true" />
        <strong>{summary.headline}</strong>
      </header>
      {summary.refs.length ? (
        <ul>
          {summary.refs.map((ref) => (
            <li key={ref.id} className={ref.isFallback ? "is-fallback" : undefined}>
              <span className="shadcn-prototype-source-thumb" aria-hidden={ref.thumbnailUrl ? undefined : true}>
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic blob:/remote thumbnail URLs are unsupported by next/image */}
                {ref.thumbnailUrl ? <img src={ref.thumbnailUrl} alt="" loading="lazy" /> : null}
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
      {summary.note ? <p>{summary.note}</p> : null}
    </section>
  );
}
