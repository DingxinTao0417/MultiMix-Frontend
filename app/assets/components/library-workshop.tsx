"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileText, Globe2, Image as ImageIcon, Image as LibraryBigImageIcon, Play, Plus, RefreshCw, Search, Sparkles, Trash2, Video, X } from "lucide-react";
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
  assets: "上传",
  copy: "上传",
  image: "上传",
  video: "上传"
};

const LIBRARY_PAGE_SIZE = 48;
const LIBRARY_REQUEST_TIMEOUT_MS = 20_000;
const LIBRARY_CACHE_TTL_MS = 30_000;
const LIBRARY_CACHE_MAX_ENTRIES = 12;

type CachedLibraryPage = {
  rows: LibraryRow[];
  nextOffset: number | null;
  expiresAt: number;
};

let libraryCacheToken: string | null = null;
const libraryPageCache = new Map<string, CachedLibraryPage>();

function libraryCacheKey(
  view: Exclude<ActiveView, "conversation">,
  query: string,
  localRefreshKey: number,
  refreshRevision: number,
) {
  return `${view}:${query}:${localRefreshKey}:${refreshRevision}`;
}

function readCachedLibraryPage(token: string, key: string): CachedLibraryPage | null {
  if (libraryCacheToken !== token) {
    libraryPageCache.clear();
    libraryCacheToken = token;
  }
  const cached = libraryPageCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    libraryPageCache.delete(key);
    return null;
  }
  return cached;
}

function writeCachedLibraryPage(token: string, key: string, rows: LibraryRow[], nextOffset: number | null) {
  if (libraryCacheToken !== token) {
    libraryPageCache.clear();
    libraryCacheToken = token;
  }
  libraryPageCache.delete(key);
  libraryPageCache.set(key, {
    rows,
    nextOffset,
    expiresAt: Date.now() + LIBRARY_CACHE_TTL_MS,
  });
  while (libraryPageCache.size > LIBRARY_CACHE_MAX_ENTRIES) {
    const oldestKey = libraryPageCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    libraryPageCache.delete(oldestKey);
  }
}

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

function libraryRowIdentity(row: LibraryRow): string {
  return row.assetId
    ? `asset:${row.assetId}`
    : `${row.kind}:${row.title}:${row.updatedAtIso ?? row.meta}`;
}

function publicCandidateTags(candidate: PublicMaterialCandidate): string[] {
  return [...new Set((candidate.understanding?.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))];
}

function publicMediaSource(candidate: PublicMaterialCandidate): string {
  return candidate.preview_url || candidate.download_url || candidate.source_url;
}

function displayMeta(row: LibraryRow, currentView: Exclude<ActiveView, "conversation">) {
  // Unified meta across text libraries: the category shows as the top badge, so
  // the meta line carries only the status. Category/contentType are not repeated
  // here (contentType lives in the detail drawer per the design doc).
  if ((currentView === "copy" || currentView === "assets") && row.category) {
    return row.statusLabel ?? "";
  }
  if (currentView !== "assets" && row.category) {
    return row.statusLabel ? `${row.category} · ${row.statusLabel}` : row.category;
  }
  if (!row.category) return row.meta;
  return row.meta.includes(row.category) ? row.meta : `${row.category} · ${row.meta}`;
}

// Reference-count label shared by every library card. A row with no usage (0 or
// missing count) reads "未使用" so users can tell it has never been referenced.
function referenceCountLabel(row: LibraryRow): string {
  return row.referenceCount ? `被引用 ${row.referenceCount} 次` : "未使用";
}

function libraryRowMediaKind(row: LibraryRow): "image" | "video" | null {
  if (row.kind === "image") return "image";
  if (row.kind === "video") return "video";
  if (row.contentType === "图片") return "image";
  if (row.contentType === "视频") return "video";
  return null;
}

function renderLibraryMediaPlaceholder(row: LibraryRow, mediaKind: "image" | "video") {
  const Icon = mediaKind === "image" ? LibraryBigImageIcon : Video;
  const label = row.format || (mediaKind === "image" ? "图片预览" : "视频预览");
  return (
    <span className={`shadcn-prototype-library-media-placeholder ${mediaKind}`} aria-hidden="true">
      <Icon size={28} strokeWidth={1.7} />
      <em>{label}</em>
    </span>
  );
}

function renderLibraryRowMedia(row: LibraryRow, view: Exclude<ActiveView, "conversation">) {
  const viewClass = view === "image" || view === "video" ? " grid" : "";
  const mediaKind = libraryRowMediaKind(row);
  return row.kind === "copy" ? null : mediaKind === "image" ? (
    <span className={row.previewUrl ? `shadcn-prototype-library-media-thumb image${viewClass}` : "shadcn-prototype-library-media-thumb empty image"} aria-hidden="true">
      {/* Thumbnails stream from the runtime-configured backend media proxy; host is not statically known. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" /> : renderLibraryMediaPlaceholder(row, "image")}
    </span>
  ) : mediaKind === "video" ? (
    <span className={row.thumbnailUrl ? `shadcn-prototype-library-media-thumb video${viewClass}` : "shadcn-prototype-library-media-thumb empty video"} aria-hidden="true">
      {/* List cards use still thumbnails only; the playable URL is mounted once in the detail modal. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" loading="lazy" /> : renderLibraryMediaPlaceholder(row, "video")}
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

function mergeLibraryRows(current: LibraryRow[], incoming: LibraryRow[]): LibraryRow[] {
  const rows = new Map<string, LibraryRow>();
  for (const row of [...current, ...incoming]) {
    rows.set(row.assetId == null ? `${row.kind}:${row.title}:${row.updatedAtIso ?? ""}` : String(row.assetId), row);
  }
  return [...rows.values()].sort((a, b) => (b.updatedAtIso ?? "").localeCompare(a.updatedAtIso ?? ""));
}

// Demo-final detail: understanding is "ready" when the status reads 已理解/
// 已解析/可检索 (final/library.html st: ok) — anything else is still pending.
function understandingReady(row: LibraryRow): boolean {
  const label = row.statusLabel ?? "";
  if (label.includes("失败")) return false;
  return label.startsWith("已") || label === "可检索";
}

// Demo-final usage record ("被「对话」引用 N 次"). We only have referenceCount,
// so synthesize the count line as a preview of the prototype's usage section.
function usageText(row: LibraryRow): string | null {
  if (row.referenceCount == null) return null;
  return row.referenceCount > 0 ? `已被引用 ${row.referenceCount} 次。` : "尚未被使用。";
}

// Demo-final voiceover 试听 bar. There is no audio URL on LibraryRow yet, so this
// mirrors the prototype's accelerated 30s progress animation as a preview.
function VoiceoverAudioBar() {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setProgress((value) => {
        if (value >= 30) {
          setPlaying(false);
          return 0;
        }
        return value + 1;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing]);

  const seconds = String(Math.min(progress, 30)).padStart(2, "0");
  return (
    <div className="shadcn-prototype-library-audio">
      <button type="button" className="ab-play" aria-label={playing ? "暂停试听" : "试听配音"} onClick={() => setPlaying((value) => !value)}>
        <Play size={12} fill="currentColor" aria-hidden="true" />
      </button>
      <span className="ab-wave" aria-hidden="true">
        <span className="ab-fill" style={{ width: `${(Math.min(progress, 30) / 30) * 100}%` }} />
      </span>
      <span className="ab-t">00:{seconds} / 00:30</span>
    </div>
  );
}

export type LibraryActionIntent = "create" | "video" | "regenerate-image" | "long-form";

function LibraryWorkshop({
  view,
  token = null,
  onUploadClick,
  uploading = false,
  onUseAsset,
  onAddAssetToConversation,
  refreshRevision = 0,
}: {
  view: Exclude<ActiveView, "conversation">;
  token?: string | null;
  onUploadClick?: () => void;
  uploading?: boolean;
  onUseAsset?: (row: LibraryRow, intent: LibraryActionIntent) => Promise<void>;
  onAddAssetToConversation?: (row: LibraryRow) => void;
  refreshRevision?: number;
}) {
  const workshop = assetWorkspaceAdapter.getWorkshop(view);
  const [backendRows, setBackendRows] = useState<LibraryRow[]>([]);
  const [libraryState, setLibraryState] = useState<"unconfigured" | "loading" | "ready" | "error">(() => (
    assetWorkspaceAdapter.isBackendEnabled() ? "loading" : "unconfigured"
  ));
  const [activeFilter, setActiveFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState<"ok" | "wait" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedRowIdentity, setSelectedRowIdentity] = useState<string | null>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
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
      setBackendRows([]);
      setNextOffset(null);
      setLibraryState(assetWorkspaceAdapter.isBackendEnabled() ? "loading" : "unconfigured");
      return;
    }
    const cacheKey = libraryCacheKey(view, debouncedQuery, localRefreshKey, refreshRevision);
    const cached = readCachedLibraryPage(token, cacheKey);
    if (cached) {
      setBackendRows(cached.rows);
      setNextOffset(cached.nextOffset);
      setLoadingRows(false);
      setLoadingMore(false);
      setLibraryState("ready");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LIBRARY_REQUEST_TIMEOUT_MS);
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setLoadingRows(true);
    setLoadingMore(false);
    setNextOffset(null);
    setLibraryState("loading");
    // React development Strict Mode mounts, cleans up, and remounts effects
    // synchronously. Deferring the request one task lets that probe cancel
    // before any network work starts, while real view changes still abort an
    // already-started request through the controller below.
    const requestStart = window.setTimeout(() => {
      if (cancelled || controller.signal.aborted) return;
      void assetWorkspaceAdapter
        .listLibrary(token, view, debouncedQuery, {
          offset: 0,
          limit: LIBRARY_PAGE_SIZE,
          signal: controller.signal,
        })
        .then((page) => {
          if (!cancelled) {
            setBackendRows(page.rows);
            setNextOffset(page.nextOffset);
            writeCachedLibraryPage(token, cacheKey, page.rows, page.nextOffset);
            setLibraryState("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setBackendRows([]);
            setLibraryState("error");
          }
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (!cancelled) setLoadingRows(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(requestStart);
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [token, view, debouncedQuery, localRefreshKey, refreshRevision]);

  useEffect(() => () => {
    loadMoreAbortRef.current?.abort();
  }, []);

  const handleLoadMore = async () => {
    if (!token || nextOffset === null || loadingMore) return;
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), LIBRARY_REQUEST_TIMEOUT_MS);
    setLoadingMore(true);
    setActionMessage(null);
    try {
      const cacheKey = libraryCacheKey(view, debouncedQuery, localRefreshKey, refreshRevision);
      const page = await assetWorkspaceAdapter.listLibrary(token, view, debouncedQuery, {
        offset: nextOffset,
        limit: LIBRARY_PAGE_SIZE,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setBackendRows((current) => {
        const merged = mergeLibraryRows(current, page.rows);
        writeCachedLibraryPage(token, cacheKey, merged, page.nextOffset);
        return merged;
      });
      setNextOffset(page.nextOffset);
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionMessage(error instanceof Error ? error.message : "加载更多失败，请重试。");
      }
    } finally {
      window.clearTimeout(timeout);
      if (loadMoreAbortRef.current === controller) loadMoreAbortRef.current = null;
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  };

  const rows = backendRows;
  const filteredRows = useMemo(() => {
    let scopedRows = activeFilter === "全部" ? rows : rows.filter((row) => row.category === activeFilter);
    if (view === "image" && statusFilter) {
      scopedRows = scopedRows.filter((row) => rowStatusKind(row) === statusFilter);
    }
    const query = debouncedQuery.trim().toLowerCase();
    if (query) return scopedRows;
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
  }, [activeFilter, statusFilter, view, rows, debouncedQuery]);
  const selectedRow = selectedRowIdentity === null
    ? null
    : filteredRows.find((row) => libraryRowIdentity(row) === selectedRowIdentity) ?? null;
  const selectedBody = useMemo(() => selectedRow ? bodyForRow(selectedRow, view) : [], [selectedRow, view]);
  const selectedKeywords = useMemo(() => selectedRow ? keywordsForRow(selectedRow, view) : [], [selectedRow, view]);

  useEffect(() => {
    setActiveFilter("全部");
    setStatusFilter(null);
    setSelectedRowIdentity(null);
  }, [view]);

  useEffect(() => {
    setSelectedRowIdentity(null);
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
      setLocalRefreshKey((value) => value + 1);
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
      setSelectedRowIdentity(null);
      setLocalRefreshKey((value) => value + 1);
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
      setLocalRefreshKey((value) => value + 1);
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
      setLocalRefreshKey((value) => value + 1);
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
      setLocalRefreshKey((value) => value + 1);
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

        {libraryState === "unconfigured" ? (
          <article className="shadcn-prototype-workshop-empty"><div><strong>未连接后端</strong><p>请配置 NEXT_PUBLIC_API_BASE_URL 后重启前端。</p></div></article>
        ) : libraryState === "error" ? (
          <article className="shadcn-prototype-workshop-empty"><div><strong>资源库加载失败</strong><p>没有展示本地样例，避免与真实数据混淆。</p><button type="button" onClick={() => setLocalRefreshKey((value) => value + 1)}>重新加载</button></div></article>
        ) : libraryState === "loading" ? (
          <article className="shadcn-prototype-workshop-empty" role="status"><div><strong>正在加载{workshop.title}…</strong></div></article>
        ) : filteredRows.length === 0 ? (
          <article className="shadcn-prototype-workshop-empty">
            <div>
              <strong>这个分类还没有内容</strong>
              <p>{activeFilter === "全部" && !statusFilter ? "上传资料或在对话中生成产物后，会在这里出现。" : "在对话里生成后会自动归档到这里。"}</p>
            </div>
          </article>
        ) : (
          <>
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
                // Unified media meta: updated time + reference count. Status shows
                // as the pill on the thumbnail, so it is not repeated here.
                const stat = [row.updatedLabel, referenceCountLabel(row)].filter(Boolean).join(" · ");
                return (
                  <button
                    key={`${row.kind}-${row.title}-${index}`}
                    type="button"
                    className={[
                      "shadcn-prototype-library-media-card",
                      libraryRowIdentity(row) === selectedRowIdentity ? "selected" : "",
                      rowMediaKind === "image" ? "with-image-media" : "",
                      rowMediaKind === "video" ? "with-video-media" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={() => setSelectedRowIdentity(libraryRowIdentity(row))}
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
                  className={libraryRowIdentity(row) === selectedRowIdentity ? "shadcn-prototype-library-text-card selected" : "shadcn-prototype-library-text-card"}
                  onClick={() => setSelectedRowIdentity(libraryRowIdentity(row))}
                >
                  <span className="shadcn-prototype-library-text-row1">
                    {view === "copy" && row.category ? <i className="cat">{row.category}</i> : null}
                    {view === "assets" ? (
                      <>
                        <i className="fic" aria-hidden="true"><FileText size={13} /></i>
                        {row.category ? <i className="cat">{row.category}</i> : null}
                        <strong>{row.title}</strong>
                      </>
                    ) : null}
                  </span>
                  {view !== "assets" ? <strong className="shadcn-prototype-library-text-title">{row.title}</strong> : null}
                  {row.note ? <p>{row.note}</p> : null}
                  <span className="shadcn-prototype-library-text-meta">
                    {[row.updatedLabel, referenceCountLabel(row), displayMeta(row, view)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {row.searchReasons && row.searchReasons.length > 0 ? (
                    <em className="shadcn-prototype-library-reasons">
                      {row.searchReasons.slice(0, 3).map((reason) => <small key={reason}>{reason}</small>)}
                    </em>
                  ) : null}
                </button>
              );
              })}
            </div>
            {nextOffset !== null ? (
              <div className="shadcn-prototype-library-load-more">
                <button type="button" disabled={loadingMore} onClick={() => void handleLoadMore()}>
                  {loadingMore ? "正在加载…" : "加载更多"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {selectedRow ? (
        <div className="shadcn-prototype-library-modal-backdrop" role="presentation" onMouseDown={() => setSelectedRowIdentity(null)}>
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
                <button type="button" aria-label="关闭详情" onClick={() => setSelectedRowIdentity(null)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* Preview (demo md-preview) */}
            {view === "image" ? (
              <div className="shadcn-prototype-library-image-preview">
                {selectedRow.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedRow.previewUrl} alt={selectedRow.title} loading="lazy" />
                ) : (
                  <>
                    <ImageIcon size={34} aria-hidden="true" />
                    <strong>{selectedRow.title}</strong>
                    <span>{selectedRow.format ?? "图片素材"}</span>
                  </>
                )}
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
            ) : null}

            {/* Content sections in demo order; actions moved to the bottom. */}
            {view === "image" ? (
              <>
                <section className="shadcn-prototype-library-content">
                  <h3>
                    AI 理解
                    {understandingReady(selectedRow) ? (
                      <span className="shadcn-prototype-library-live-badge"><i className="shadcn-prototype-library-gdot" aria-hidden="true" />已理解</span>
                    ) : null}
                  </h3>
                  {understandingReady(selectedRow) ? (
                    <div className="shadcn-prototype-library-understand">{selectedRow.understandingCaption || selectedRow.note || "暂无描述"}</div>
                  ) : (
                    <div className="shadcn-prototype-library-pending">
                      <span className="row"><i className="shadcn-prototype-library-gdot" aria-hidden="true" />AI 正在理解这张图…</span>
                      <span className="bar" aria-hidden="true" />
                      <span className="hint">完成后会自动生成画面描述、可用场景和检索关键词</span>
                    </div>
                  )}
                </section>
                {selectedRow.understandingRoles && selectedRow.understandingRoles.length > 0 ? (
                  <section className="shadcn-prototype-library-content">
                    <h3>可用场景</h3>
                    <div className="shadcn-prototype-library-chips">
                      {selectedRow.understandingRoles.slice(0, 6).map((role) => <span key={role}>{role}</span>)}
                    </div>
                  </section>
                ) : null}
                <section className="shadcn-prototype-library-content">
                  <h3>检索关键词</h3>
                  <div className="shadcn-prototype-library-chips">
                    {selectedKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                  </div>
                </section>
                {usageText(selectedRow) ? (
                  <section className="shadcn-prototype-library-content">
                    <h3>使用记录</h3>
                    <div className="shadcn-prototype-library-usage">{usageText(selectedRow)}</div>
                  </section>
                ) : null}
              </>
            ) : view === "copy" ? (
              <>
                <section className="shadcn-prototype-library-content">
                  <h3>{selectedRow.detailLabel ?? DETAIL_TITLES[selectedRow.kind]}</h3>
                  <div className="shadcn-prototype-library-prose">
                    {selectedBody.map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>)}
                  </div>
                </section>
                {selectedRow.category === "配音稿" ? (
                  <section className="shadcn-prototype-library-content">
                    <h3>试听 <span className="shadcn-prototype-library-live-badge"><i className="shadcn-prototype-library-gdot" aria-hidden="true" />配音预览</span></h3>
                    <VoiceoverAudioBar />
                  </section>
                ) : null}
                <section className="shadcn-prototype-library-content">
                  <h3>来源</h3>
                  <div className="shadcn-prototype-library-usage">{selectedRow.sourceLabel ?? selectedRow.meta}{usageText(selectedRow) ? ` · ${usageText(selectedRow)}` : ""}</div>
                </section>
              </>
            ) : view === "video" ? (
              <>
                <section className="shadcn-prototype-library-content">
                  <h3>规格</h3>
                  <div className="shadcn-prototype-library-usage">{[selectedRow.format, selectedRow.meta].filter(Boolean).join(" · ") || "视频素材"}</div>
                </section>
                <section className="shadcn-prototype-library-content">
                  <h3>{isDigitalHuman(selectedRow) ? "口播文稿" : selectedRow.detailLabel ?? DETAIL_TITLES[selectedRow.kind]}</h3>
                  {isDigitalHuman(selectedRow) ? (
                    <div className="shadcn-prototype-library-prose">
                      {selectedBody.map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>)}
                    </div>
                  ) : (
                    <div className="shadcn-prototype-library-timeline">
                      {selectedBody.map((line, index) => (
                        <article key={`${line}-${index}`}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <p>{line}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                {selectedRow.understandingTags && selectedRow.understandingTags.length > 0 ? (
                  <section className="shadcn-prototype-library-content">
                    <h3>检索关键词</h3>
                    <div className="shadcn-prototype-library-chips">
                      {selectedRow.understandingTags.slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <>
                <section className="shadcn-prototype-library-content">
                  <h3>
                    AI 摘要
                    {understandingReady(selectedRow) ? (
                      <span className="shadcn-prototype-library-live-badge"><i className="shadcn-prototype-library-gdot" aria-hidden="true" />已解析</span>
                    ) : null}
                  </h3>
                  {selectedRow.statusLabel === "解析失败" ? (
                    <div className="shadcn-prototype-library-understand">这份资料解析失败，可重试处理后再查看摘要。</div>
                  ) : understandingReady(selectedRow) ? (
                    <div className="shadcn-prototype-library-understand">{selectedBody.map((paragraph, index) => <p key={`${paragraph}-${index}`} style={index > 0 ? { marginTop: 8 } : undefined}>{paragraph}</p>)}</div>
                  ) : (
                    <div className="shadcn-prototype-library-pending">
                      <span className="row"><i className="shadcn-prototype-library-gdot" aria-hidden="true" />AI 正在解析这份资料…</span>
                      <span className="bar" aria-hidden="true" />
                      <span className="hint">完成后会自动生成摘要和检索关键词</span>
                    </div>
                  )}
                </section>
                <section className="shadcn-prototype-library-content">
                  <h3>检索关键词</h3>
                  <div className="shadcn-prototype-library-chips">
                    {selectedKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
                  </div>
                </section>
                <dl className="shadcn-prototype-library-meta">
                  <div><dt>来源分类</dt><dd>{selectedRow.category ?? "待识别"}</dd></div>
                  <div><dt>内容类型</dt><dd>{selectedRow.contentType ?? "资料"}</dd></div>
                  <div><dt>处理状态</dt><dd>{selectedRow.statusLabel ?? "待解析"}</dd></div>
                  <div><dt>来源</dt><dd>{selectedRow.sourceLabel ?? selectedRow.meta}</dd></div>
                  <div><dt>索引状态</dt><dd>{selectedRow.statusLabel === "解析失败" ? "未入库" : "可检索"}</dd></div>
                </dl>
                {sourceOpen ? (
                  <section className="shadcn-prototype-library-content">
                    <h3>来源详情</h3>
                    <div className="shadcn-prototype-library-prose">
                      <p>来源：{selectedRow.sourceLabel ?? selectedRow.meta}</p>
                      {selectedRow.sourceUrl ? <p>URL：{selectedRow.sourceUrl}</p> : null}
                      {selectedRow.sourceRefs?.length ? <p>引用：{selectedRow.sourceRefs.join(" / ")}</p> : <p>暂无来源引用。</p>}
                    </div>
                  </section>
                ) : null}
              </>
            )}

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

            {/* Actions at the bottom (demo md-acts) */}
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
                  <button type="button" disabled={!selectedRow.assetId || !onAddAssetToConversation} onClick={() => { if (selectedRow) onAddAssetToConversation?.(selectedRow); }}><Plus size={14} aria-hidden="true" />加入对话</button>
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
                  {selectedRow.contentTypeCode === "long_form_video_source" ? (
                    <button
                      type="button"
                      disabled={!selectedRow.assetId || !onUseAsset || selectedRow.statusLabel !== "已入库"}
                      title={selectedRow.statusLabel === "已入库" ? "分析原片并推荐可发布的短视频片段" : "原片准备完成后即可拆条"}
                      onClick={() => { if (selectedRow) void onUseAsset?.(selectedRow, "long-form"); }}
                    >
                      <Video size={14} aria-hidden="true" />拆成短视频
                    </button>
                  ) : null}
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
                  <p>{publicSelected.understanding.caption || publicSelected.body_text || "无摘要。"}</p>
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

export default memo(LibraryWorkshop);
