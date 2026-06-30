"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileText, Image as ImageIcon, MessageSquareText, Play, Plus, RefreshCw, Search, Sparkles, Upload, Video, X } from "lucide-react";
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

function isCaptionableImage(row: LibraryRow) {
  return row.kind === "image" && (row.contentType === "图片" || typeof row.captionStatus === "string");
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type LibraryActionIntent = "create" | "video" | "regenerate-image";

export default function LibraryWorkshop({
  view,
  token = null,
  onUploadClick,
  uploading = false,
  onUseAsset,
  onAddAssetToConversation
}: {
  view: Exclude<ActiveView, "conversation">;
  token?: string | null;
  onUploadClick?: () => void;
  uploading?: boolean;
  onUseAsset?: (row: LibraryRow, intent: LibraryActionIntent) => Promise<void>;
  onAddAssetToConversation?: (row: LibraryRow) => void;
}) {
  const workshop = assetWorkspaceAdapter.getWorkshop(view);
  const [backendRows, setBackendRows] = useState<LibraryRow[] | null>(null);
  const [activeFilter, setActiveFilter] = useState("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [assetModal, setAssetModal] = useState<"text" | "web" | null>(null);
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webTitle, setWebTitle] = useState("");
  const [webBody, setWebBody] = useState("");
  const [submittingAsset, setSubmittingAsset] = useState(false);

  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setBackendRows(null);
      return;
    }
    let cancelled = false;
    setLoadingRows(true);
    void assetWorkspaceAdapter
      .listLibrary(token, view, searchQuery)
      .then((rows) => {
        if (!cancelled) setBackendRows(rows);
      })
      .catch(() => {
        if (!cancelled) setBackendRows(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingRows(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, view, searchQuery, refreshKey]);

  // Prefer real backend rows when available; keep prototype sample rows visible
  // when the connected library is still empty.
  const rows = backendRows && backendRows.length > 0 ? backendRows : workshop.rows;
  const filteredRows = useMemo(() => {
    const scopedRows = activeFilter === "全部" ? rows : rows.filter((row) => row.category === activeFilter);
    const query = searchQuery.trim().toLowerCase();
    if (backendRows && query) return scopedRows;
    if (!query) return scopedRows;
    return scopedRows.filter((row) => {
      const haystack = [
        row.title,
        row.meta,
        row.note,
        row.category,
        row.contentType,
        row.statusLabel,
        row.sourceLabel,
        ...(row.keywords ?? []),
        ...(row.sourceRefs ?? []),
        ...(row.body ?? [])
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [activeFilter, backendRows, rows, searchQuery]);
  const selectedRow = selectedIndex === null ? null : filteredRows[selectedIndex];
  const selectedBody = useMemo(() => selectedRow ? bodyForRow(selectedRow, view) : [], [selectedRow, view]);
  const selectedKeywords = useMemo(() => selectedRow ? keywordsForRow(selectedRow, view) : [], [selectedRow, view]);

  useEffect(() => {
    setActiveFilter("全部");
    setSelectedIndex(null);
  }, [view, backendRows]);

  useEffect(() => {
    setSelectedIndex(null);
    setSourceOpen(false);
  }, [activeFilter, searchQuery]);

  const canUseBackend = Boolean(token && assetWorkspaceAdapter.isBackendEnabled());

  const handleCreateTextAsset = async () => {
    if (!token || !textTitle.trim() || !textBody.trim()) return;
    setSubmittingAsset(true);
    setActionMessage(null);
    try {
      await assetWorkspaceAdapter.createTextAsset(token, { title: textTitle.trim(), bodyMarkdown: textBody.trim() });
      setAssetModal(null);
      setTextTitle("");
      setTextBody("");
      setRefreshKey((value) => value + 1);
      setActionMessage("文本资产已入库。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "新建文本失败。");
    } finally {
      setSubmittingAsset(false);
    }
  };

  const handleCreateWebCapture = async () => {
    if (!token || !webUrl.trim() || !webBody.trim()) return;
    setSubmittingAsset(true);
    setActionMessage(null);
    try {
      await assetWorkspaceAdapter.createWebCapture(token, {
        url: webUrl.trim(),
        title: webTitle.trim() || undefined,
        body: webBody.trim()
      });
      setAssetModal(null);
      setWebUrl("");
      setWebTitle("");
      setWebBody("");
      setRefreshKey((value) => value + 1);
      setActionMessage("网页资料已导入。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "导入网页失败。");
    } finally {
      setSubmittingAsset(false);
    }
  };

  const handleExport = async (row: LibraryRow, label = "asset") => {
    if (!token || !row.assetId) return;
    setActionMessage(null);
    try {
      const blob = await assetWorkspaceAdapter.exportAssetMarkdown(token, row.assetId);
      downloadBlob(blob, `${row.title || label}.md`);
      setActionMessage("已导出 Markdown。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "导出失败。");
    }
  };

  const handleRetry = async (row: LibraryRow) => {
    if (!token || !row.assetId) return;
    setActionMessage(null);
    try {
      const job = await assetWorkspaceAdapter.retryAssetIngest(token, row.assetId);
      setRefreshKey((value) => value + 1);
      setActionMessage(`处理完成：${job.status} / ${job.stage}`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "重试处理失败。");
    }
  };

  const handleCaption = async (row: LibraryRow) => {
    if (!token || !row.assetId) return;
    setActionMessage(null);
    try {
      await assetWorkspaceAdapter.regenerateImageCaption(token, row.assetId);
      setRefreshKey((value) => value + 1);
      setActionMessage("图片说明已更新。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "图片说明生成失败。");
    }
  };

  const handleCopyRow = async (row: LibraryRow) => {
    const text = bodyForRow(row, view).join("\n\n");
    setActionMessage(null);
    try {
      await navigator.clipboard.writeText(text);
      setActionMessage("已复制正文。");
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
      setActionMessage("已复制正文。");
    }
  };

  const handleOpenEditor = (row: LibraryRow) => {
    if (!row.assetId) return;
    window.open(`/app/assets?asset=${encodeURIComponent(String(row.assetId))}&view=video`, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="shadcn-prototype-card shadcn-prototype-workshop" aria-label={workshop.title}>
      <div className="shadcn-prototype-workshop-body">
        <div className="shadcn-prototype-library-toolbar">
          <label className="shadcn-prototype-library-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label={`搜索${workshop.title}`}
              placeholder={SEARCH_PLACEHOLDER[view]}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          {loadingRows ? <span className="shadcn-prototype-library-loading">搜索中</span> : null}
          {view === "assets" ? (
            <>
              <button type="button" disabled={!canUseBackend} onClick={() => setAssetModal("text")}>
                <Plus size={15} aria-hidden="true" />
                新建文本
              </button>
              <button type="button" disabled={!canUseBackend} onClick={() => setAssetModal("web")}>
                <FileText size={15} aria-hidden="true" />
                导入网页
              </button>
            </>
          ) : null}
          <button type="button" onClick={onUploadClick} disabled={!onUploadClick || uploading}>
            <Upload size={15} aria-hidden="true" />
            {uploading ? "上传中" : "上传"}
          </button>
        </div>
        {actionMessage ? <p className="shadcn-prototype-library-action-message" role="status">{actionMessage}</p> : null}

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
                    {row.searchReasons && row.searchReasons.length > 0 ? (
                      <em className="shadcn-prototype-library-reasons">
                        {row.searchReasons.slice(0, 3).map((reason) => <small key={reason}>{reason}</small>)}
                      </em>
                    ) : null}
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
                <button type="button" aria-label="播放视频预览" disabled title="暂无可播放预览">
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
                  <button type="button" onClick={() => { if (selectedRow) void handleCopyRow(selectedRow); }}><Copy size={14} aria-hidden="true" />复制</button>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "video"); }}><Video size={14} aria-hidden="true" />生成视频</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleExport(selectedRow, "copy"); }}><Download size={14} aria-hidden="true" />导出</button>
                </>
              ) : view === "image" ? (
                <>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  {isCaptionableImage(selectedRow) ? (
                    <button type="button" disabled={!selectedRow.assetId || selectedRow.captionStatus === "unavailable"} title={selectedRow.captionStatus === "unavailable" ? "未配置图片说明服务" : "生成图片说明"} onClick={() => { if (selectedRow) void handleCaption(selectedRow); }}><FileText size={14} aria-hidden="true" />生成图片说明</button>
                  ) : null}
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleExport(selectedRow, "image"); }}><Download size={14} aria-hidden="true" />下载</button>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "regenerate-image"); }}><ImageIcon size={14} aria-hidden="true" />重新生成</button>
                </>
              ) : view === "video" ? (
                <>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) handleOpenEditor(selectedRow); }}><Video size={14} aria-hidden="true" />打开剪辑器</button>
                  {isDigitalHuman(selectedRow) ? <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleExport(selectedRow, "script"); }}><FileText size={14} aria-hidden="true" />导出口播稿</button> : null}
                </>
              ) : (
                <>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button" disabled={!selectedRow.assetId || !onAddAssetToConversation} onClick={() => { if (selectedRow) onAddAssetToConversation?.(selectedRow); }}><Plus size={14} aria-hidden="true" />加入对话</button>
                  <button type="button" onClick={() => setSourceOpen((value) => !value)}><FileText size={14} aria-hidden="true" />查看来源</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleExport(selectedRow, "asset"); }}><Download size={14} aria-hidden="true" />导出</button>
                  {selectedRow.statusLabel === "解析失败" ? (
                    <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleRetry(selectedRow); }}><RefreshCw size={14} aria-hidden="true" />重试处理</button>
                  ) : null}
                </>
              )}
            </div>

            {sourceOpen ? (
              <section className="shadcn-prototype-library-content">
                <h3>来源详情</h3>
                <div className="shadcn-prototype-library-prose">
                  <p>来源：{selectedRow.sourceLabel ?? selectedRow.meta}</p>
                  {selectedRow.sourceUrl ? <p>URL：{selectedRow.sourceUrl}</p> : null}
                  {selectedRow.sourceRefs?.length ? <p>引用：{selectedRow.sourceRefs.join(" / ")}</p> : <p>暂无来源引用。</p>}
                  <p>{selectedBody[0] ?? selectedRow.note}</p>
                </div>
              </section>
            ) : null}

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

            {selectedRow.sourceRefs && selectedRow.sourceRefs.length > 0 ? (
              <section className="shadcn-prototype-library-keywords">
                <h3>来源引用</h3>
                <div>
                  {selectedRow.sourceRefs.map((sourceRef) => (
                    <span key={sourceRef}>{sourceRef}</span>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedRow.versions && selectedRow.versions.length > 0 ? (
              <section className="shadcn-prototype-library-keywords">
                <h3>版本历史</h3>
                <div>
                  {selectedRow.versions.map((version) => (
                    <span key={version}>{version}</span>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}
      {assetModal ? (
        <div className="shadcn-prototype-library-modal-backdrop" role="presentation" onMouseDown={() => setAssetModal(null)}>
          <aside
            className="shadcn-prototype-library-detail shadcn-prototype-library-modal"
            aria-label={assetModal === "text" ? "新建文本资产" : "导入网页资料"}
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>资产入库</span>
                <h2>{assetModal === "text" ? "新建文本资产" : "导入网页资料"}</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setAssetModal(null)}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            {assetModal === "text" ? (
              <div className="shadcn-prototype-asset-form">
                <label>
                  <span>标题</span>
                  <input value={textTitle} onChange={(event) => setTextTitle(event.currentTarget.value)} placeholder="例如：品牌语气规范" />
                </label>
                <label>
                  <span>正文</span>
                  <textarea value={textBody} onChange={(event) => setTextBody(event.currentTarget.value)} rows={8} placeholder="粘贴要沉淀到资产库的文本内容" />
                </label>
                <button type="button" className="primary" disabled={submittingAsset || !textTitle.trim() || !textBody.trim()} onClick={() => { void handleCreateTextAsset(); }}>
                  {submittingAsset ? "保存中" : "保存入库"}
                </button>
              </div>
            ) : (
              <div className="shadcn-prototype-asset-form">
                <label>
                  <span>URL</span>
                  <input value={webUrl} onChange={(event) => setWebUrl(event.currentTarget.value)} placeholder="https://example.com/article" />
                </label>
                <label>
                  <span>标题</span>
                  <input value={webTitle} onChange={(event) => setWebTitle(event.currentTarget.value)} placeholder="可选" />
                </label>
                <label>
                  <span>网页正文</span>
                  <textarea value={webBody} onChange={(event) => setWebBody(event.currentTarget.value)} rows={8} placeholder="粘贴网页正文或 Reader Markdown" />
                </label>
                <button type="button" className="primary" disabled={submittingAsset || !webUrl.trim() || !webBody.trim()} onClick={() => { void handleCreateWebCapture(); }}>
                  {submittingAsset ? "导入中" : "导入入库"}
                </button>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
