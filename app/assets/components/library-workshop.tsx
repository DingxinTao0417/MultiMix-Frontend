"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileText, Image as ImageIcon, MessageSquareText, Play, Search, Sparkles, Upload, Video, X } from "lucide-react";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import type { ActiveView } from "../lib/asset-workspace-shared";

const FILTERS: Record<Exclude<ActiveView, "conversation">, string[]> = {
  assets: ["全部", "上传资料", "采集资料", "对话沉淀"],
  copy: ["全部", "选题方案", "文案稿", "配音稿", "编导稿"],
  image: ["全部", "封面图", "素材图", "分镜图"],
  video: ["全部", "视频工程", "混剪视频", "数字人视频", "MG动画视频", "实景拍摄视频", "生成视频素材"]
};

const SEARCH_PLACEHOLDER: Record<Exclude<ActiveView, "conversation">, string> = {
  assets: "搜索资料 / 来源 / 关键词",
  copy: "搜索文案 / 关键词",
  image: "搜索图片 / 画面 / 关键词",
  video: "搜索视频 / 口播 / 关键词"
};

const DETAIL_TITLES: Record<LibraryRow["kind"], string> = {
  copy: "文案正文",
  image: "图片预览",
  video: "视频预览",
  file: "资料内容"
};

function iconForKind(kind: LibraryRow["kind"]) {
  if (kind === "video") return <Video size={15} aria-hidden="true" />;
  if (kind === "image") return <ImageIcon size={15} aria-hidden="true" />;
  if (kind === "copy") return <MessageSquareText size={15} aria-hidden="true" />;
  return <FileText size={15} aria-hidden="true" />;
}

function bodyForRow(row: LibraryRow, view: Exclude<ActiveView, "conversation">): string[] {
  if (row.body && row.body.length > 0) return row.body;
  if (row.note && row.note !== "（无摘要）") return [row.note];
  if (view === "image") return ["这张图片还没有补充画面说明，后续可由 LLM 自动提取主体、风格、场景和可复用关键词。"];
  if (view === "video") return ["这个视频还没有补充口播或分镜信息，后续可由 LLM 自动提取内容摘要和检索关键词。"];
  return ["暂无正文内容。"];
}

function keywordsForRow(row: LibraryRow, view: Exclude<ActiveView, "conversation">): string[] {
  if (row.keywords && row.keywords.length > 0) return row.keywords;
  const defaults: Record<Exclude<ActiveView, "conversation">, string[]> = {
    assets: ["资料", "来源", "可检索"],
    copy: ["文案", "可复用", "待标注"],
    image: ["图片", "画面", "待标注"],
    video: ["视频", "口播", "待标注"]
  };
  return defaults[view];
}

function isDigitalHuman(row: LibraryRow) {
  return row.variant === "digital-human" || /数字人/.test(`${row.title} ${row.meta} ${row.note}`);
}

function displayMeta(row: LibraryRow, currentView: Exclude<ActiveView, "conversation">) {
  if (currentView !== "assets" && row.category) {
    return row.statusLabel ? `${row.category} · ${row.statusLabel}` : row.category;
  }
  if (currentView === "assets" && row.category) {
    const detail = [row.contentType, row.statusLabel].filter(Boolean).join(" · ");
    return detail ? `${row.category} · ${detail}` : row.category;
  }
  if (!row.category) return row.meta;
  return row.meta.includes(row.category) ? row.meta : `${row.category} · ${row.meta}`;
}

export default function LibraryWorkshop({ view, token = null }: { view: Exclude<ActiveView, "conversation">; token?: string | null }) {
  const workshop = assetWorkspaceAdapter.getWorkshop(view);
  const [backendRows, setBackendRows] = useState<LibraryRow[] | null>(null);
  const [activeFilter, setActiveFilter] = useState("全部");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setBackendRows(null);
      return;
    }
    let cancelled = false;
    void assetWorkspaceAdapter
      .listLibrary(token, view)
      .then((rows) => {
        if (!cancelled) setBackendRows(rows);
      })
      .catch(() => {
        if (!cancelled) setBackendRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, view]);

  // Prefer real backend rows when available; keep prototype sample rows visible
  // when the connected library is still empty.
  const rows = backendRows && backendRows.length > 0 ? backendRows : workshop.rows;
  const filteredRows = useMemo(
    () => activeFilter === "全部" ? rows : rows.filter((row) => row.category === activeFilter),
    [activeFilter, rows]
  );
  const selectedRow = selectedIndex === null ? null : filteredRows[selectedIndex];
  const selectedBody = useMemo(() => selectedRow ? bodyForRow(selectedRow, view) : [], [selectedRow, view]);
  const selectedKeywords = useMemo(() => selectedRow ? keywordsForRow(selectedRow, view) : [], [selectedRow, view]);

  useEffect(() => {
    setActiveFilter("全部");
    setSelectedIndex(null);
  }, [view, backendRows]);

  useEffect(() => {
    setSelectedIndex(null);
  }, [activeFilter]);

  return (
    <section className="shadcn-prototype-card shadcn-prototype-workshop" aria-label={workshop.title}>
      <div className="shadcn-prototype-workshop-body">
        <div className="shadcn-prototype-library-toolbar">
          <label className="shadcn-prototype-library-search">
            <Search size={15} aria-hidden="true" />
            <input aria-label={`搜索${workshop.title}`} placeholder={SEARCH_PLACEHOLDER[view]} />
          </label>
          <button type="button">
            <Upload size={15} aria-hidden="true" />
            上传
          </button>
        </div>

        <div className="shadcn-prototype-library-filters" aria-label={`${workshop.title}筛选`}>
          {FILTERS[view].map((filter) => (
            <button
              key={filter}
              type="button"
              className={filter === activeFilter ? "active" : undefined}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>

        {filteredRows.length === 0 ? (
          <article className="shadcn-prototype-workshop-empty">
            <div>
              <strong>暂无内容</strong>
              <p>{activeFilter === "全部" ? "上传资料或在对话中生成产物后，会在这里出现。" : `还没有${activeFilter}，上传或生成后会在这里出现。`}</p>
            </div>
          </article>
        ) : (
          <div className={`shadcn-prototype-library-layout ${view === "image" ? "image-mode" : ""}`}>
            <div className="shadcn-prototype-workshop-list" aria-label={`${workshop.title}列表`}>
              {filteredRows.map((row, index) => (
                <button
                  key={`${row.kind}-${row.title}-${index}`}
                  type="button"
                  className={index === selectedIndex ? "selected" : undefined}
                  onClick={() => setSelectedIndex(index)}
                >
                  {view === "image" ? (
                    <span className="shadcn-prototype-library-thumb" aria-hidden="true">
                      <ImageIcon size={18} />
                    </span>
                  ) : (
                    <span className="shadcn-prototype-file-icon">{iconForKind(row.kind)}</span>
                  )}
                  <span className="shadcn-prototype-library-row-copy">
                    <strong>{row.title}</strong>
                    <span>{displayMeta(row, view)}</span>
                    <p>{row.note}</p>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {selectedRow ? (
        <div className="shadcn-prototype-library-modal-backdrop" role="presentation" onMouseDown={() => setSelectedIndex(null)}>
          <aside
            className="shadcn-prototype-library-detail shadcn-prototype-library-modal"
            aria-label={`${selectedRow.title}详情`}
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>{displayMeta(selectedRow, view)}</span>
                <h2>{selectedRow.title}</h2>
              </div>
              <div className="shadcn-prototype-library-modal-title-actions">
                {isDigitalHuman(selectedRow) ? <em>数字人视频</em> : null}
                <button type="button" aria-label="关闭详情" onClick={() => setSelectedIndex(null)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            {view === "image" ? (
              <div className="shadcn-prototype-library-image-preview">
                <ImageIcon size={34} aria-hidden="true" />
                <strong>{selectedRow.title}</strong>
                <span>{selectedRow.format ?? "图片素材"}</span>
              </div>
            ) : view === "video" ? (
              <div className="shadcn-prototype-library-video-preview">
                <button type="button" aria-label="播放视频预览">
                  <Play size={22} fill="currentColor" aria-hidden="true" />
                </button>
                <span>{selectedRow.format ?? "视频预览"}</span>
              </div>
            ) : view === "assets" ? (
              <dl className="shadcn-prototype-library-meta">
                <div><dt>来源分类</dt><dd>{selectedRow.category ?? "待识别"}</dd></div>
                <div><dt>内容类型</dt><dd>{selectedRow.contentType ?? "资料"}</dd></div>
                <div><dt>处理状态</dt><dd>{selectedRow.statusLabel ?? "待解析"}</dd></div>
                <div><dt>来源</dt><dd>{selectedRow.sourceLabel ?? selectedRow.meta}</dd></div>
                <div><dt>索引状态</dt><dd>{selectedRow.statusLabel === "解析失败" ? "未入库" : "可检索"}</dd></div>
              </dl>
            ) : null}

            <div className="shadcn-prototype-library-actions">
              {view === "copy" ? (
                <>
                  <button type="button"><Copy size={14} aria-hidden="true" />复制</button>
                  <button type="button"><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button"><Video size={14} aria-hidden="true" />生成视频</button>
                </>
              ) : view === "image" ? (
                <>
                  <button type="button"><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button"><Download size={14} aria-hidden="true" />下载</button>
                  <button type="button"><ImageIcon size={14} aria-hidden="true" />重新生成</button>
                </>
              ) : view === "video" ? (
                <>
                  <button type="button"><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button"><Video size={14} aria-hidden="true" />打开剪辑器</button>
                  {isDigitalHuman(selectedRow) ? <button type="button"><FileText size={14} aria-hidden="true" />导出口播稿</button> : null}
                </>
              ) : (
                <>
                  <button type="button"><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button"><FileText size={14} aria-hidden="true" />查看来源</button>
                </>
              )}
            </div>

            <section className="shadcn-prototype-library-content">
              <h3>{view === "video" && isDigitalHuman(selectedRow) ? "口播文稿" : selectedRow.detailLabel ?? DETAIL_TITLES[selectedRow.kind]}</h3>
              {view === "video" && !isDigitalHuman(selectedRow) ? (
                <div className="shadcn-prototype-library-timeline">
                  {selectedBody.map((line, index) => (
                    <article key={`${line}-${index}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <p>{line}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="shadcn-prototype-library-prose">
                  {selectedBody.map((paragraph, index) => (
                    <p key={`${paragraph}-${index}`}>{paragraph}</p>
                  ))}
                </div>
              )}
            </section>

            {view === "image" ? (
              <dl className="shadcn-prototype-library-meta">
                <div><dt>比例</dt><dd>{selectedRow.format ?? "待识别"}</dd></div>
                <div><dt>风格</dt><dd>由 LLM 标注</dd></div>
                <div><dt>来源</dt><dd>{selectedRow.meta}</dd></div>
              </dl>
            ) : view === "video" ? (
              <dl className="shadcn-prototype-library-meta">
                <div><dt>时长</dt><dd>{selectedRow.format?.split("·")[1]?.trim() ?? "待识别"}</dd></div>
                <div><dt>类型</dt><dd>{isDigitalHuman(selectedRow) ? "数字人" : "普通视频"}</dd></div>
                <div><dt>平台</dt><dd>{selectedKeywords.includes("小红书") ? "小红书" : "待确认"}</dd></div>
              </dl>
            ) : null}

            <section className="shadcn-prototype-library-keywords">
              <h3>检索关键词</h3>
              <div>
                {selectedKeywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
