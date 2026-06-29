"use client";

import { getProductModeLabel, getProductRatioClass, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import ProductPreview from "./product-preview";
import VideoProjectWorkspace from "./video-project-workspace";

export function EmptyProductWorkspace() {
  return (
    <section className="shadcn-prototype-card shadcn-prototype-artifact" aria-label="Empty product workspace">
      <div className="shadcn-prototype-product">
        <header className="shadcn-prototype-product-header">
          <div>
            <h3>等待确认创作方向</h3>
            <p>还没有生成产物</p>
          </div>
        </header>
        <div className="shadcn-prototype-product-main">
          <div className="shadcn-prototype-product-preview">
            <div>
              <strong>先从对话开始</strong>
              <span>明确要文案、图片提示词或视频后，这里会展示生成结果。</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProductWorkspace({
  copied,
  onCopyProduct,
  onSaveProduct,
  onProductUpdated,
  product,
  savedVersion,
  selectedConversation,
  token
}: {
  copied: boolean;
  onCopyProduct: (product: ProductArtifact) => Promise<void>;
  onSaveProduct: (product: ProductArtifact) => Promise<void>;
  onProductUpdated?: (product: ProductArtifact) => void;
  product: ProductArtifact;
  savedVersion?: string;
  selectedConversation: Conversation;
  token?: string | null;
}) {
  const modeLabel = getProductModeLabel(product.mode);
  const hasSpeechTimeline = product.mode === "digital-human" && product.timeline.some((item) => item.line);
  // Video products backed by a real orchestration project can open the editor.
  const hasVideoProject = Boolean(
    product.backendAssetId &&
    product.metadata &&
    typeof product.metadata === "object" &&
    (product.metadata as Record<string, unknown>).video_project
  );
  // While the orchestration job runs (TTS + material search), there is no
  // editable project yet; surface a pending hint instead of the editor link.
  const orchestrationPending = Boolean(
    product.backendAssetId &&
    !hasVideoProject &&
    product.metadata &&
    typeof product.metadata === "object" &&
    (product.metadata as Record<string, unknown>).orchestration_pending
  );
  const previewClassName = [
    "shadcn-prototype-product-preview",
    product.mode,
    getProductRatioClass(product.ratio)
  ].filter(Boolean).join(" ");

  return (
    <section className="shadcn-prototype-card shadcn-prototype-artifact" aria-label="Current product workspace">
      <div className={hasVideoProject ? "shadcn-prototype-product video-project-mode" : "shadcn-prototype-product"}>
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
            {orchestrationPending ? (
              <span className="shadcn-prototype-product-pending" aria-live="polite">
                生成中…
              </span>
            ) : null}
            <button className="primary" type="button" onClick={() => void onSaveProduct(product)}>
              {savedVersion ? `已保存 ${savedVersion}` : "保存"}
            </button>
          </div>
        </header>

        {hasVideoProject ? (
          <VideoProjectWorkspace product={product} token={token} onProjectUpdated={onProductUpdated} />
        ) : (
          <div className="shadcn-prototype-product-main">
            <div className={previewClassName}>
              <ProductPreview product={product} />
            </div>
          </div>
        )}

        {!hasVideoProject && product.timeline.length > 0 ? (
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
