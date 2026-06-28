"use client";

import { useState } from "react";
import { getProductModeLabel, getProductRatioClass, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import ProductPreview from "./product-preview";

export default function ProductWorkspace({
  copied,
  onCopyProduct,
  onSaveProduct,
  onRenderVideo,
  product,
  savedVersion,
  selectedConversation
}: {
  copied: boolean;
  onCopyProduct: (product: ProductArtifact) => Promise<void>;
  onSaveProduct: (product: ProductArtifact) => Promise<void>;
  onRenderVideo?: (product: ProductArtifact) => Promise<void>;
  product: ProductArtifact;
  savedVersion?: string;
  selectedConversation: Conversation;
}) {
  const [rendering, setRendering] = useState(false);
  const modeLabel = getProductModeLabel(product.mode);
  const hasSpeechTimeline = product.mode === "digital-human" && product.timeline.some((item) => item.line);
  // Video products backed by a real orchestration project can open the editor.
  const hasVideoProject = Boolean(
    product.backendAssetId &&
    product.metadata &&
    typeof product.metadata === "object" &&
    (product.metadata as Record<string, unknown>).video_project
  );
  const previewClassName = [
    "shadcn-prototype-product-preview",
    product.mode,
    getProductRatioClass(product.ratio)
  ].filter(Boolean).join(" ");

  return (
    <section className="shadcn-prototype-card shadcn-prototype-artifact" aria-label="Current product workspace">
      <div className="shadcn-prototype-product">
        <header className="shadcn-prototype-product-header">
          <div>
            <h3>{product.title}</h3>
            <p>{modeLabel} · {product.status} · {product.ratio} / {product.duration}</p>
          </div>
          <div className="shadcn-prototype-product-actions">
            <details className="shadcn-prototype-product-detail-popover">
              <summary className="shadcn-prototype-product-detail-trigger">详情</summary>
              <aside className="shadcn-prototype-product-detail-drawer" aria-label="生成详情">
                <header>
                  <div>
                    <span>生成详情</span>
                    <strong>{product.title}</strong>
                  </div>
                </header>

                <div className="shadcn-prototype-detail-status">
                  <article>
                    <span>当前状态</span>
                    <strong>{product.phase}</strong>
                    <em>{product.status}</em>
                  </article>
                  <article>
                    <span>来源依据</span>
                    <strong>{selectedConversation.assetLabel}</strong>
                    <em>{selectedConversation.status}</em>
                  </article>
                  <article>
                    <span>规格</span>
                    <strong>{product.ratio} / {product.duration}</strong>
                    <em>{modeLabel}</em>
                  </article>
                </div>

                <section className="shadcn-prototype-detail-section">
                  <h4>内容与可调整项</h4>
                  <div className="shadcn-prototype-adjustment-list drawer">
                    {product.sections.map((section) => (
                      <article key={`${section.label}-${section.title}`}>
                        <div>
                          <span>{section.label}</span>
                          <strong>{section.title}</strong>
                        </div>
                        <p>{section.detail}</p>
                        <em>{section.status}</em>
                      </article>
                    ))}
                  </div>
                </section>

              </aside>
            </details>
            {product.mode === "copy" ? (
              <button type="button" onClick={() => void onCopyProduct(product)}>
                {copied ? "已复制" : "复制"}
              </button>
            ) : null}
            {hasVideoProject ? (
              <a
                className="shadcn-prototype-open-editor"
                href={`/editor?asset=${encodeURIComponent(String(product.backendAssetId))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开剪辑器
              </a>
            ) : null}
            {hasVideoProject && onRenderVideo && product.backendAssetId && !((product.metadata as Record<string, unknown>)?.video_project as Record<string, unknown> | undefined)?.mp4_state ? (
              <button
                type="button"
                disabled={rendering}
                onClick={async () => {
                  setRendering(true);
                  try { await onRenderVideo(product); } finally { setRendering(false); }
                }}
              >
                {rendering ? "生成中…" : "生成成片"}
              </button>
            ) : null}
            <button className="primary" type="button" onClick={() => void onSaveProduct(product)}>
              {savedVersion ? `已保存 ${savedVersion}` : "保存"}
            </button>
          </div>
        </header>

        <div className="shadcn-prototype-product-main">
          <div className={previewClassName}>
            <ProductPreview product={product} />
          </div>
        </div>

        {product.timeline.length > 0 ? (
          <section
            className={hasSpeechTimeline ? "shadcn-prototype-product-timeline-strip speech" : "shadcn-prototype-product-timeline-strip"}
            aria-label={hasSpeechTimeline ? "音轨和字幕时间轴" : "时间轴预览"}
          >
            <div className="shadcn-prototype-product-timeline-items">
              {product.timeline.map((item) => (
                <article key={`${item.time}-${item.title}`}>
                  <time>{item.time}</time>
                  <strong>{item.title}</strong>
                  <span>{item.line ?? item.status}</span>
                  {item.line ? <em>{item.status}</em> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

      </div>
    </section>
  );
}
