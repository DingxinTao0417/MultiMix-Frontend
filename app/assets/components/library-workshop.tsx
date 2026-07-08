"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileText, Globe2, Image as ImageIcon, Play, Plus, RefreshCw, Search, Sparkles, Trash2, Video, X } from "lucide-react";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import type { ActiveView } from "../lib/asset-workspace-shared";
import type { PublicMaterialCandidate, PublicSourceRead } from "../../../lib/api";

const FILTERS: Record<Exclude<ActiveView, "conversation">, string[]> = {
  assets: ["全部", "上传资料", "采集资料", "对话沉淀"],
  copy: ["全部", "选题方案", "文案稿", "配音稿", "编导稿"],
  image: ["全部", "封面图", "素材图", "分镜图"],
  video: ["全部", "混剪视频", "数字人视频", "MG动画视频", "实景拍摄视频", "生成视频素材"]
};

const SEARCH_PLACEHOLDER: Record<Exclude<ActiveView, "conversation">, string> = {
  assets: "搜索资料 / 知识块…",
  copy: "搜索文案 / 选题…",
  image: "搜索素材…",
  video: "搜索视频…"
};

const UPLOAD_LABEL: Record<Exclude<ActiveView, "conversation">, string> = {
  assets: "上传资料",
  copy: "上传",
  image: "上传素材",
  video: "上传"
};

// Demo-final status classification (library.html st: ok/wait) shared by the
// on-card pill and the image-library status filter chips.
function rowStatusKind(row: LibraryRow): "ok" | "wait" | "fail" | null {
  if (!row.statusLabel) return null;
  if (row.statusLabel.includes("失败")) return "fail";
  if (row.statusLabel.startsWith("已") || row.statusLabel === "可检索") return "ok";
  return "wait";
}

const DETAIL_TITLES: Record<LibraryRow["kind"], string> = {
  copy: "文案正文",
  image: "图片预览",
  video: "视频预览",
  file: "资料内容"
};

function bodyForRow(row: LibraryRow, view: Exclude<ActiveView, "conversation">): string[] {
  if (row.body && row.body.length > 0) return row.body;
  if (row.note && row.note !== "（无摘要）") return [row.note];
  if (view === "image") return ["这张图片还没有完成素材理解，可以重新解析素材，补充标签、描述和适合的分镜角色。"];
  if (view === "video") return ["这个视频还没有完成素材理解，可以重新解析素材，补充标签、描述和适合的分镜角色。"];
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

function isReparsableMedia(row: LibraryRow) {
  return row.kind === "image" || row.kind === "video";
}

function publicCandidateTags(candidate: PublicMaterialCandidate): string[] {
  return [...new Set((candidate.visual?.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))];
}

function publicMediaSource(candidate: PublicMaterialCandidate): string {
  return candidate.preview_url || candidate.download_url || candidate.source_url;
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

function libraryRowMediaKind(row: LibraryRow): "image" | "video" | null {
  if (row.kind === "image") return "image";
  if (row.kind === "video") return "video";
  if (row.contentType === "图片") return "image";
  if (row.contentType === "视频") return "video";
  return null;
}

function renderLibraryRowMedia(row: LibraryRow, view: Exclude<ActiveView, "conversation">) {
  const viewClass = view === "image" || view === "video" ? " grid" : "";
  const mediaKind = libraryRowMediaKind(row);
  return row.kind === "copy" ? null : mediaKind === "image" ? (
    <span className={row.previewUrl ? `shadcn-prototype-library-media-thumb image${viewClass}` : "shadcn-prototype-library-media-thumb empty image"} aria-hidden="true">
      {/* Thumbnails stream from the runtime-configured backend media proxy; host is not statically known. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" /> : <span>无</span>}
    </span>
  ) : mediaKind === "video" ? (
    <span className={row.previewUrl ? `shadcn-prototype-library-media-thumb video${viewClass}` : "shadcn-prototype-library-media-thumb empty video"} aria-hidden="true">
      {row.previewUrl ? <video src={row.previewUrl} muted playsInline preload="metadata" /> : <span>无</span>}
    </span>
  ) : null;
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

function downloadFilename(row: LibraryRow, label = "asset") {
  const sourceName = (row.sourceLabel ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  if (/\.[A-Za-z0-9]{2,8}$/.test(sourceName)) return sourceName;
  const title = (row.title || label).replace(/[\\/:*?"<>|]+/g, "-").trim() || label;
  if (row.kind === "copy" || row.kind === "file") return `${title}.md`;
  if (row.kind === "image") return /\.[A-Za-z0-9]{2,8}$/.test(title) ? title : `${title}.png`;
  if (row.kind === "video") return /\.[A-Za-z0-9]{2,8}$/.test(title) ? title : `${title}.mp4`;
  return title;
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
  const [statusFilter, setStatusFilter] = useState<"ok" | "wait" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [assetModal, setAssetModal] = useState<"web" | null>(null);
  const [webUrl, setWebUrl] = useState("");
  const [webTitle, setWebTitle] = useState("");
  const [webBody, setWebBody] = useState("");
  const [submittingAsset, setSubmittingAsset] = useState(false);
  const [publicSearchOpen, setPublicSearchOpen] = useState(false);
  const [publicSources, setPublicSources] = useState<PublicSourceRead[]>([]);
  const [selectedPublicProviders, setSelectedPublicProviders] = useState<string[]>([]);
  const [publicQuery, setPublicQuery] = useState("");
  const [publicMediaTypes, setPublicMediaTypes] = useState<Array<"text" | "image" | "video">>(["text", "image", "video"]);
  const [publicResults, setPublicResults] = useState<PublicMaterialCandidate[]>([]);
  const [publicSelected, setPublicSelected] = useState<PublicMaterialCandidate | null>(null);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicMessage, setPublicMessage] = useState<string | null>(null);

  // Debounce the raw input so backend search fires once per pause, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setBackendRows(null);
      return;
    }
    let cancelled = false;
    setLoadingRows(true);
    void assetWorkspaceAdapter
      .listLibrary(token, view, debouncedQuery)
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
  }, [token, view, debouncedQuery, refreshKey]);

  const rows = backendRows !== null ? backendRows : workshop.rows;
  const filteredRows = useMemo(() => {
    let scopedRows = activeFilter === "全部" ? rows : rows.filter((row) => row.category === activeFilter);
    if (view === "image" && statusFilter) {
      scopedRows = scopedRows.filter((row) => rowStatusKind(row) === statusFilter);
    }
    const query = debouncedQuery.trim().toLowerCase();
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
  }, [activeFilter, statusFilter, view, backendRows, rows, debouncedQuery]);
  const selectedRow = selectedIndex === null ? null : filteredRows[selectedIndex];
  const selectedBody = useMemo(() => selectedRow ? bodyForRow(selectedRow, view) : [], [selectedRow, view]);
  const selectedKeywords = useMemo(() => selectedRow ? keywordsForRow(selectedRow, view) : [], [selectedRow, view]);

  useEffect(() => {
    setActiveFilter("全部");
    setStatusFilter(null);
    setSelectedIndex(null);
  }, [view, backendRows]);

  useEffect(() => {
    setSelectedIndex(null);
    setSourceOpen(false);
  }, [activeFilter, statusFilter, searchQuery]);

  const canUseBackend = Boolean(token && assetWorkspaceAdapter.isBackendEnabled());

  useEffect(() => {
    if (!publicSearchOpen || !token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    let cancelled = false;
    void assetWorkspaceAdapter.listPublicSources(token)
      .then((sources) => {
        if (cancelled) return;
        setPublicSources(sources);
        setSelectedPublicProviders((current) => current.length ? current.filter((provider) => sources.some((source) => source.provider === provider)) : sources.map((source) => source.provider));
      })
      .catch((error) => {
        if (!cancelled) setPublicMessage(error instanceof Error ? error.message : "公开素材源读取失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [publicSearchOpen, token]);

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
      setActionMessage(error instanceof Error ? error.message : "读取网页失败。");
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

  const handleDownload = async (row: LibraryRow, label = "asset") => {
    if (!token || !row.assetId) return;
    setActionMessage(null);
    try {
      const blob = await assetWorkspaceAdapter.downloadAsset(token, row.assetId);
      downloadBlob(blob, downloadFilename(row, label));
      setActionMessage("已开始下载。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "下载失败。");
    }
  };

  const handleDelete = async (row: LibraryRow) => {
    if (!token || !row.assetId) return;
    const confirmed = window.confirm(`确认删除「${row.title}」吗？删除后将从当前库隐藏。`);
    if (!confirmed) return;
    setActionMessage(null);
    try {
      await assetWorkspaceAdapter.deleteAsset(token, row.assetId);
      setSelectedIndex(null);
      setRefreshKey((value) => value + 1);
      setActionMessage("已删除。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "删除失败。");
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

  const handleReparse = async (row: LibraryRow) => {
    if (!token || !row.assetId) return;
    setActionMessage(null);
    try {
      await assetWorkspaceAdapter.reparseAsset(token, row.assetId);
      setRefreshKey((value) => value + 1);
      setActionMessage("素材已重新解析。");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "素材重新解析失败。");
    }
  };

  const handleRunPublicSearch = async () => {
    if (!token || !publicQuery.trim()) return;
    setPublicLoading(true);
    setPublicMessage(null);
    setPublicSelected(null);
    try {
      const candidates = await assetWorkspaceAdapter.searchPublicMaterials(token, {
        query: publicQuery.trim(),
        mediaTypes: publicMediaTypes,
        providers: selectedPublicProviders,
        limit: 12
      });
      setPublicResults(candidates);
      setPublicMessage(candidates.length ? `找到 ${candidates.length} 个公开素材候选。` : "未找到公开素材候选。");
    } catch (error) {
      setPublicMessage(error instanceof Error ? error.message : "公开素材搜索失败。");
    } finally {
      setPublicLoading(false);
    }
  };

  const handleImportPublicMaterial = async (candidate: PublicMaterialCandidate) => {
    if (!token) return;
    setPublicMessage(null);
    try {
      await assetWorkspaceAdapter.importPublicMaterial(token, candidate);
      setRefreshKey((value) => value + 1);
      setPublicMessage("公开素材已保存入库。");
    } catch (error) {
      setPublicMessage(error instanceof Error ? error.message : "公开素材保存失败。");
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
          <h2 className="shadcn-prototype-library-title">{workshop.title}</h2>
          <label className="shadcn-prototype-library-search compact">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label={`搜索${workshop.title}`}
              placeholder={SEARCH_PLACEHOLDER[view]}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          {loadingRows ? <span className="shadcn-prototype-library-loading" aria-label="正在搜索" /> : null}
          <button type="button" className="primary" onClick={onUploadClick} disabled={!onUploadClick || uploading}>
            <Plus size={15} aria-hidden="true" />
            {uploading ? "上传中" : UPLOAD_LABEL[view]}
          </button>
          {view === "assets" ? (
            <>
              <button type="button" disabled={!canUseBackend} onClick={() => setAssetModal("web")}>
                <FileText size={15} aria-hidden="true" />
                读取网页
              </button>
              <button type="button" disabled={!canUseBackend} onClick={() => setPublicSearchOpen(true)}>
                <Globe2 size={15} aria-hidden="true" />
                公开素材搜索
              </button>
            </>
          ) : null}
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
          {view === "image" ? (
            <>
              <span className="shadcn-prototype-library-filter-sep" aria-hidden="true" />
              <button
                type="button"
                className={statusFilter === "ok" ? "active with-dot" : "with-dot"}
                onClick={() => setStatusFilter((current) => current === "ok" ? null : "ok")}
              >
                <i className="dot-ok" aria-hidden="true" />
                已解析
              </button>
              <button
                type="button"
                className={statusFilter === "wait" ? "active with-dot" : "with-dot"}
                onClick={() => setStatusFilter((current) => current === "wait" ? null : "wait")}
              >
                <i className="dot-wait" aria-hidden="true" />
                待处理
              </button>
            </>
          ) : null}
        </div>

        {filteredRows.length === 0 ? (
          <article className="shadcn-prototype-workshop-empty">
            <div>
              <strong>这个分类还没有内容</strong>
              <p>{activeFilter === "全部" && !statusFilter ? "上传资料或在对话中生成产物后，会在这里出现。" : "在对话里生成后会自动归档到这里。"}</p>
            </div>
          </article>
        ) : (
          <div className={`shadcn-prototype-library-grid view-${view}`} aria-label={`${workshop.title}列表`}>
            {filteredRows.map((row, index) => {
              const statusKind = rowStatusKind(row);
              const statusPill = row.statusLabel && statusKind ? (
                <i className={`shadcn-prototype-library-status ${statusKind === "fail" ? "is-failed" : statusKind === "ok" ? "is-done" : "is-pending"}`}>
                  {row.statusLabel}
                </i>
              ) : null;
              if (view === "image" || view === "video") {
                // Demo-final media card: type label + status pill overlay the
                // thumbnail; the body keeps only title + usage stat.
                const rowMedia = renderLibraryRowMedia(row, view);
                const rowMediaKind = libraryRowMediaKind(row);
                const stat = row.referenceCount != null
                  ? (row.referenceCount > 0 ? `被引用 ${row.referenceCount} 次` : "未使用")
                  : statusKind === "wait" ? "刚上传" : "";
                return (
                  <button
                    key={`${row.kind}-${row.title}-${index}`}
                    type="button"
                    className={[
                      "shadcn-prototype-library-media-card",
                      index === selectedIndex ? "selected" : "",
                      rowMediaKind === "image" ? "with-image-media" : "",
                      rowMediaKind === "video" ? "with-video-media" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <span className="shadcn-prototype-library-media-frame">
                      {row.category ? <span className="shadcn-prototype-library-media-cat">{row.category}</span> : null}
                      {statusPill}
                      {rowMedia}
                    </span>
                    <span className="shadcn-prototype-library-media-body">
                      <strong>{row.title}</strong>
                      {stat ? <em>{stat}</em> : null}
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={`${row.kind}-${row.title}-${index}`}
                  type="button"
                  className={index === selectedIndex ? "shadcn-prototype-library-text-card selected" : "shadcn-prototype-library-text-card"}
                  onClick={() => setSelectedIndex(index)}
                >
                  <span className="shadcn-prototype-library-text-row1">
                    {view === "copy" && row.category ? <i className="cat">{row.category}</i> : null}
                    {view === "assets" ? (
                      <>
                        <i className="fic" aria-hidden="true"><FileText size={13} /></i>
                        <strong>{row.title}</strong>
                      </>
                    ) : null}
                  </span>
                  {view !== "assets" ? <strong className="shadcn-prototype-library-text-title">{row.title}</strong> : null}
                  {row.note ? <p>{row.note}</p> : null}
                  <span className="shadcn-prototype-library-text-meta">
                    {displayMeta(row, view)}
                    {row.referenceCount != null ? ` · 被引用 ${row.referenceCount} 次` : ""}
                  </span>
                  {row.searchReasons && row.searchReasons.length > 0 ? (
                    <em className="shadcn-prototype-library-reasons">
                      {row.searchReasons.slice(0, 3).map((reason) => <small key={reason}>{reason}</small>)}
                    </em>
                  ) : null}
                </button>
              );
            })}
            {(view === "image" || view === "assets") && onUploadClick ? (
              <button
                type="button"
                className="shadcn-prototype-library-upload-card"
                onClick={onUploadClick}
                disabled={uploading}
              >
                <Plus size={20} aria-hidden="true" />
                {view === "image" ? "上传更多素材" : "上传更多资料"}
              </button>
            ) : null}
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
              selectedRow.previewUrl ? (
                <div className="shadcn-prototype-library-video-preview playable">
                  <video
                    key={selectedRow.previewUrl}
                    src={selectedRow.previewUrl}
                    controls
                    preload="metadata"
                    playsInline
                    aria-label={`${selectedRow.title}视频预览`}
                  />
                </div>
              ) : (
                <div className="shadcn-prototype-library-video-preview">
                  <button type="button" aria-label="播放视频预览" disabled title="暂无可播放预览">
                    <Play size={22} fill="currentColor" aria-hidden="true" />
                  </button>
                  <span>{selectedRow.format ?? "视频预览"}</span>
                </div>
              )
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
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDownload(selectedRow, "copy"); }}><Download size={14} aria-hidden="true" />下载</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDelete(selectedRow); }}><Trash2 size={14} aria-hidden="true" />删除</button>
                </>
              ) : view === "image" ? (
                <>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  {isReparsableMedia(selectedRow) ? (
                    <button type="button" disabled={!selectedRow.assetId} title="重新解析素材" onClick={() => { if (selectedRow) void handleReparse(selectedRow); }}><FileText size={14} aria-hidden="true" />重新解析素材</button>
                  ) : null}
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDownload(selectedRow, "image"); }}><Download size={14} aria-hidden="true" />下载</button>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "regenerate-image"); }}><ImageIcon size={14} aria-hidden="true" />重新生成</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDelete(selectedRow); }}><Trash2 size={14} aria-hidden="true" />删除</button>
                </>
              ) : view === "video" ? (
                <>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  {isReparsableMedia(selectedRow) ? (
                    <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleReparse(selectedRow); }}><FileText size={14} aria-hidden="true" />重新解析素材</button>
                  ) : null}
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDownload(selectedRow, "video"); }}><Download size={14} aria-hidden="true" />下载</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) handleOpenEditor(selectedRow); }}><Video size={14} aria-hidden="true" />打开剪辑器</button>
                  {isDigitalHuman(selectedRow) ? <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleExport(selectedRow, "script"); }}><FileText size={14} aria-hidden="true" />导出口播稿</button> : null}
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDelete(selectedRow); }}><Trash2 size={14} aria-hidden="true" />删除</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={!selectedRow.assetId || !onUseAsset} onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "create"); }}><Sparkles size={14} aria-hidden="true" />用于创作</button>
                  <button type="button" disabled={!selectedRow.assetId || !onAddAssetToConversation} onClick={() => { if (selectedRow) onAddAssetToConversation?.(selectedRow); }}><Plus size={14} aria-hidden="true" />加入对话</button>
                  <button type="button" onClick={() => setSourceOpen((value) => !value)}><FileText size={14} aria-hidden="true" />查看来源</button>
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDownload(selectedRow, "asset"); }}><Download size={14} aria-hidden="true" />下载</button>
                  {selectedRow.statusLabel === "解析失败" ? (
                    <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleRetry(selectedRow); }}><RefreshCw size={14} aria-hidden="true" />重试处理</button>
                  ) : null}
                  <button type="button" disabled={!selectedRow.assetId} onClick={() => { if (selectedRow) void handleDelete(selectedRow); }}><Trash2 size={14} aria-hidden="true" />删除</button>
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
                <div><dt>理解状态</dt><dd>{selectedRow.statusLabel ?? "待理解"}</dd></div>
                <div><dt>标签</dt><dd>{selectedRow.understandingTags?.slice(0, 6).join("、") || "暂无标签"}</dd></div>
                <div><dt>适合角色</dt><dd>{selectedRow.understandingRoles?.slice(0, 3).join("、") || "待识别"}</dd></div>
              </dl>
            ) : view === "video" ? (
              <dl className="shadcn-prototype-library-meta">
                <div><dt>理解状态</dt><dd>{selectedRow.statusLabel ?? "待理解"}</dd></div>
                <div><dt>标签</dt><dd>{selectedRow.understandingTags?.slice(0, 6).join("、") || "暂无标签"}</dd></div>
                <div><dt>适合角色</dt><dd>{selectedRow.understandingRoles?.slice(0, 3).join("、") || "待识别"}</dd></div>
              </dl>
            ) : null}

            {(view === "image" || view === "video") ? (
              <section className="shadcn-prototype-library-keywords">
                <h3>素材理解</h3>
                <div>
                  <span>{selectedRow.understandingCaption || selectedRow.note || "暂无描述"}</span>
                </div>
              </section>
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
      {publicSearchOpen ? (
        <div className="shadcn-prototype-library-modal-backdrop" role="presentation" onMouseDown={() => setPublicSearchOpen(false)}>
          <aside
            className="shadcn-prototype-library-detail shadcn-prototype-library-modal shadcn-prototype-public-search"
            aria-label="公开素材搜索"
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>公开素材源</span>
                <h2>公开素材搜索</h2>
              </div>
              <button type="button" aria-label="关闭公开素材搜索" onClick={() => setPublicSearchOpen(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="shadcn-prototype-public-search-controls">
              <label>
                <span>关键词</span>
                <input value={publicQuery} onChange={(event) => setPublicQuery(event.target.value)} placeholder="例如：台灯、舞台灯光、厨房翻新" />
              </label>
              <div className="shadcn-prototype-public-search-checks" aria-label="媒体类型">
                {(["text", "image", "video"] as const).map((mediaType) => (
                  <label key={mediaType}>
                    <input
                      type="checkbox"
                      checked={publicMediaTypes.includes(mediaType)}
                      onChange={(event) => {
                        setPublicMediaTypes((current) => event.target.checked
                          ? [...new Set([...current, mediaType])]
                          : current.filter((item) => item !== mediaType));
                      }}
                    />
                    {mediaType === "text" ? "文案" : mediaType === "image" ? "图片" : "视频"}
                  </label>
                ))}
              </div>
              <div className="shadcn-prototype-public-search-checks" aria-label="公开数据源">
                {publicSources.map((source) => (
                  <label key={source.provider}>
                    <input
                      type="checkbox"
                      checked={selectedPublicProviders.includes(source.provider)}
                      onChange={(event) => {
                        setSelectedPublicProviders((current) => event.target.checked
                          ? [...new Set([...current, source.provider])]
                          : current.filter((item) => item !== source.provider));
                      }}
                    />
                    {source.name}
                    <small>{source.media_types.map((item) => item === "text" ? "文案" : item === "image" ? "图片" : "视频").join("、")}</small>
                  </label>
                ))}
              </div>
              <button type="button" disabled={publicLoading || !publicQuery.trim() || publicMediaTypes.length === 0 || selectedPublicProviders.length === 0} onClick={() => void handleRunPublicSearch()}>
                <Search size={15} aria-hidden="true" />
                {publicLoading ? "搜索中" : "搜索公开素材"}
              </button>
              {publicMessage ? <p role="status">{publicMessage}</p> : null}
            </div>
            <div className="shadcn-prototype-public-results">
              {publicResults.map((candidate) => {
                const tags = publicCandidateTags(candidate);
                const src = publicMediaSource(candidate);
                return (
                  <article key={candidate.id}>
                    <button type="button" className="shadcn-prototype-public-card" onClick={() => setPublicSelected(candidate)}>
                      <span className="shadcn-prototype-public-thumb">
                        {/* External material sources span arbitrary hosts, so next/image remotePatterns cannot cover them. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {candidate.media_type === "image" && src ? <img src={src} alt={candidate.title} loading="lazy" /> : candidate.media_type === "video" && src ? <img src={src} alt={candidate.title} loading="lazy" /> : <Globe2 size={22} />}
                      </span>
                      <strong>{candidate.title}</strong>
                      <small>{candidate.provider} · {candidate.license_label}</small>
                      <span className="shadcn-prototype-public-tags">
                        {tags.slice(0, 5).map((tag) => <em key={tag}>{tag}</em>)}
                      </span>
                    </button>
                    <button type="button" onClick={() => void handleImportPublicMaterial(candidate)}>保存</button>
                  </article>
                );
              })}
            </div>
            {publicSelected ? (
              <section className="shadcn-prototype-library-content">
                <h3>{publicSelected.title}</h3>
                <div className="shadcn-prototype-library-prose">
                  <p>{publicSelected.visual.caption || publicSelected.body_text || "无摘要。"}</p>
                  <p>标签：{publicCandidateTags(publicSelected).join("、") || "暂无标签"}</p>
                  <p>来源：{publicSelected.provider}</p>
                  <p>作者：{publicSelected.creator || "未提供"}</p>
                  <p>许可证：{publicSelected.license_label}{publicSelected.license ? `（${publicSelected.license}）` : ""}</p>
                  <p>链接：{publicSelected.source_url}</p>
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
            aria-label="读取网页资料"
            aria-modal="true"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>资产入库</span>
                <h2>读取网页资料</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setAssetModal(null)}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
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
                {submittingAsset ? "读取中" : "读取入库"}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
