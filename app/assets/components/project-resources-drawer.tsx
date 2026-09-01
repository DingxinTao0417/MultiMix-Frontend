"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";

import useDialogFocusManagement from "../lib/use-dialog-focus-management";

export type ProjectResourceKind = "source" | "copy" | "cover" | "video";
export type ProjectResourceScope = "active" | "history" | "all";

export type ProjectResourceItem = {
  id: number;
  title: string;
  kind: ProjectResourceKind;
  membershipState: "active" | "removed" | null;
  historicalReferenceCount: number;
  status: string;
  assetKind: string;
  contentType: string;
  sourceType: string;
  updatedAt: string;
};

export type ProjectResourcePage = {
  items: ProjectResourceItem[];
  total: number;
  offset: number;
  limit: number;
};

export type ProjectResourceSummary = {
  sources: number;
  historicalSources: number;
  copies: number;
  covers: number;
  videos: number;
};

const PAGE_SIZE = 20;

export default function ProjectResourcesDrawer({
  open,
  projectTitle,
  summary,
  loadResources,
  onClose,
  onAddSource,
  onRemoveSource,
  onReaddSource,
  onOpenResource,
}: {
  open: boolean;
  projectTitle: string;
  summary: ProjectResourceSummary;
  loadResources: (
    kind: ProjectResourceKind,
    scope: ProjectResourceScope,
    offset: number,
    limit: number,
  ) => Promise<ProjectResourcePage>;
  onClose: () => void;
  onAddSource: () => void;
  onRemoveSource: (assetId: number) => Promise<void>;
  onReaddSource: (assetId: number) => Promise<void>;
  onOpenResource: (item: ProjectResourceItem) => void;
}) {
  const [kind, setKind] = useState<ProjectResourceKind>("source");
  const [sourceScope, setSourceScope] = useState<"active" | "history">("active");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ProjectResourcePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingAssetId, setPendingAssetId] = useState<number | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const scope: ProjectResourceScope = kind === "source" ? sourceScope : "all";

  useDialogFocusManagement({
    open,
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadResources(kind, scope, offset, PAGE_SIZE)
      .then((nextPage) => {
        if (!cancelled) setPage(nextPage);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPage(null);
          setError(cause instanceof Error ? cause.message : "项目资源加载失败，请重试。");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, loadResources, offset, open, reloadRevision, scope]);

  if (!open) return null;

  const selectKind = (nextKind: ProjectResourceKind) => {
    setKind(nextKind);
    setOffset(0);
    setPage(null);
  };

  const changeMembership = async (item: ProjectResourceItem) => {
    if (item.membershipState === "active") {
      const confirmed = window.confirm(
        "确定移出项目吗？只影响今后的生成，旧文案、旧封面和旧视频不会改变。",
      );
      if (!confirmed) return;
    }
    setPendingAssetId(item.id);
    setError("");
    try {
      if (item.membershipState === "active") {
        await onRemoveSource(item.id);
      } else {
        await onReaddSource(item.id);
      }
      setReloadRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目资源操作失败，请重试。");
    } finally {
      setPendingAssetId(null);
    }
  };

  const tabs: Array<{ kind: ProjectResourceKind; label: string; count: number }> = [
    { kind: "source", label: "素材", count: summary.sources + summary.historicalSources },
    { kind: "copy", label: "文案", count: summary.copies },
    { kind: "cover", label: "封面", count: summary.covers },
    { kind: "video", label: "视频", count: summary.videos },
  ];

  return (
    <div className="shadcn-prototype-project-resources-mask" role="presentation" onClick={onClose}>
      <aside
        ref={dialogRef}
        className="shadcn-prototype-project-resources-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${projectTitle}的项目资源`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shadcn-prototype-project-resources-head">
          <div>
            <strong>项目资源</strong>
            <span>{projectTitle}</span>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="关闭项目资源" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <nav className="shadcn-prototype-project-resources-tabs" aria-label="项目资源分类">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.kind}
              aria-pressed={kind === tab.kind}
              onClick={() => selectKind(tab.kind)}
            >
              {tab.label} {tab.count}
            </button>
          ))}
        </nav>

        {kind === "source" ? (
          <div className="shadcn-prototype-project-resources-scope" aria-label="素材使用状态">
            <button
              type="button"
              aria-pressed={sourceScope === "active"}
              onClick={() => { setSourceScope("active"); setOffset(0); setPage(null); }}
            >
              当前使用 {summary.sources}
            </button>
            <button
              type="button"
              aria-pressed={sourceScope === "history"}
              onClick={() => { setSourceScope("history"); setOffset(0); setPage(null); }}
            >
              历史使用 {summary.historicalSources}
            </button>
            <button type="button" onClick={onAddSource}>
              <Plus size={14} aria-hidden="true" />添加素材
            </button>
          </div>
        ) : null}

        {loading ? <p role="status">项目资源加载中…</p> : null}
        {error ? (
          <div role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setReloadRevision((value) => value + 1)}>
              <RefreshCw size={14} aria-hidden="true" />重试
            </button>
          </div>
        ) : null}

        {!loading && !error && page?.items.length === 0 ? (
          <p>{kind === "source" && sourceScope === "history" ? "还没有历史使用素材。" : "这一类资源还没有内容。"}</p>
        ) : null}

        {!loading && page?.items.length ? (
          <ul className="shadcn-prototype-project-resources-list">
            {page.items.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <button type="button" onClick={() => onOpenResource(item)}>{item.title}</button>
                {item.kind === "source" ? (
                  <>
                    {item.membershipState === "removed" && item.historicalReferenceCount > 0 ? (
                      <span>旧版本引用 {item.historicalReferenceCount} 次</span>
                    ) : null}
                    <button
                      type="button"
                      disabled={pendingAssetId === item.id}
                      onClick={() => void changeMembership(item)}
                    >
                      {pendingAssetId === item.id
                        ? "处理中…"
                        : item.membershipState === "active"
                          ? "移出项目"
                          : "重新加入项目"}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => onOpenResource(item)}>查看</button>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {page && page.total > page.limit ? (
          <footer className="shadcn-prototype-project-resources-pagination">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
            <span>{Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(page.total / PAGE_SIZE)}</span>
            <button type="button" disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
