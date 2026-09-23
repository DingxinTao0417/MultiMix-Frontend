"use client";

import { useEffect, useRef, useState } from "react";
import { File, FileText, Image as ImageIcon, RefreshCw, Video, X } from "lucide-react";

import ConfirmationDialog from "../../components/confirmation-dialog";
import useDialogFocusManagement from "../lib/use-dialog-focus-management";
import type { ProjectSourceContentRole, ProjectSourceUsePolicy } from "../lib/asset-workspace-types";

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
  contentRole?: ProjectSourceContentRole | null;
  usePolicy?: ProjectSourceUsePolicy | null;
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
  onRemoveSource,
  onReaddSource,
  onOpenResource,
  onUseSourceForNextMessage,
  onPermanentDeleteSource,
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
  onRemoveSource: (assetId: number) => Promise<void>;
  onReaddSource: (assetId: number) => Promise<void>;
  onOpenResource: (item: ProjectResourceItem) => void;
  onUseSourceForNextMessage?: (item: ProjectResourceItem) => void;
  onPermanentDeleteSource?: (assetId: number) => Promise<void>;
}) {
  const [kind, setKind] = useState<ProjectResourceKind>("source");
  const [sourceScope, setSourceScope] = useState<"active" | "history">("active");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ProjectResourcePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingAssetId, setPendingAssetId] = useState<number | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    action: "remove" | "delete";
    item: ProjectResourceItem;
  } | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabs: Array<{ kind: ProjectResourceKind; label: string; count: number }> = [
    { kind: "source", label: "素材", count: summary.sources },
    { kind: "copy", label: "文案", count: summary.copies },
    { kind: "cover", label: "封面", count: summary.covers },
    { kind: "video", label: "视频", count: summary.videos },
  ];
  const visibleTabs = tabs.filter((tab) => tab.count > 0);
  const activeKind = visibleTabs.some((tab) => tab.kind === kind)
    ? kind
    : visibleTabs[0]?.kind ?? "source";
  const activeSourceScope = sourceScope === "history" || summary.sources > 0
    ? sourceScope
    : "history";
  const scope: ProjectResourceScope = activeKind === "source" ? activeSourceScope : "all";
  const totalResources = tabs.reduce((total, tab) => total + tab.count, 0);

  useDialogFocusManagement({
    open: open && pendingConfirmation === null,
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void loadResources(activeKind, scope, offset, PAGE_SIZE)
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
  }, [activeKind, loadResources, offset, open, reloadRevision, scope]);

  if (!open) return null;

  const selectKind = (nextKind: ProjectResourceKind) => {
    setKind(nextKind);
    setOffset(0);
    setPage(null);
  };

  const changeMembership = async (item: ProjectResourceItem) => {
    if (item.membershipState === "active") {
      setPendingConfirmation({ action: "remove", item });
      return;
    }
    setPendingAssetId(item.id);
    setError("");
    try {
      await onReaddSource(item.id);
      setReloadRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目资源操作失败，请重试。");
    } finally {
      setPendingAssetId(null);
    }
  };

  const permanentlyDelete = async (item: ProjectResourceItem) => {
    if (!onPermanentDeleteSource) return;
    setPendingConfirmation({ action: "delete", item });
  };

  const confirmPendingAction = async () => {
    if (!pendingConfirmation) return;
    const { action, item } = pendingConfirmation;
    setPendingAssetId(item.id);
    setError("");
    try {
      if (action === "remove") {
        await onRemoveSource(item.id);
      } else if (onPermanentDeleteSource) {
        await onPermanentDeleteSource(item.id);
      }
      setReloadRevision((value) => value + 1);
      setPendingConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : action === "remove"
          ? "项目资源操作失败，请重试。"
          : "源文件无法永久删除。");
    } finally {
      setPendingAssetId(null);
    }
  };

  const resourceIcon = (item: ProjectResourceItem) => {
    if (item.kind === "copy") return <FileText size={18} aria-hidden="true" />;
    if (item.kind === "cover" || item.assetKind === "image") return <ImageIcon size={18} aria-hidden="true" />;
    if (item.kind === "video" || item.assetKind === "video") return <Video size={18} aria-hidden="true" />;
    return <File size={18} aria-hidden="true" />;
  };

  return (
    <>
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
            <strong>本项目资料 <span>· {totalResources}</span></strong>
            <p>会用于后续对话与生成</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="关闭项目资源" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <nav className="shadcn-prototype-project-resources-tabs" aria-label="项目资料分类">
          {visibleTabs.map((tab) => (
            <button
              type="button"
              key={tab.kind}
              aria-pressed={activeKind === tab.kind}
              onClick={() => selectKind(tab.kind)}
            >
              {tab.label} {tab.count}
            </button>
          ))}
        </nav>

        {activeKind === "source" && summary.sources > 0 && summary.historicalSources > 0 ? (
          <div className="shadcn-prototype-project-resources-scope" aria-label="素材使用状态">
            <button
              type="button"
              aria-pressed={activeSourceScope === "active"}
              onClick={() => { setSourceScope("active"); setOffset(0); setPage(null); }}
            >
              可用于后续生成
            </button>
            <button
              type="button"
              aria-pressed={activeSourceScope === "history"}
              onClick={() => { setSourceScope("history"); setOffset(0); setPage(null); }}
            >
              已移出 {summary.historicalSources}
            </button>
          </div>
        ) : null}

        {activeKind === "source" && summary.historicalSources > 0 && summary.sources === 0 ? (
          <p className="shadcn-prototype-project-resources-scope-caption">已移出项目的资料仍保留历史引用，可随时重新加入。</p>
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
          <p className="shadcn-prototype-project-resources-empty">
            {activeKind === "source" && activeSourceScope === "history" ? "还没有已移出的资料。" : "这里还没有资料。"}
          </p>
        ) : null}

        {!loading && page?.items.length ? (
          <ul className="shadcn-prototype-project-resources-list">
            {page.items.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <div className="shadcn-prototype-project-resource-identity">
                    <span className="shadcn-prototype-project-resource-icon" data-kind={item.kind}>{resourceIcon(item)}</span>
                  <button type="button" onClick={() => onOpenResource(item)}>{item.title}</button>
                  <small>
                    {item.membershipState === "removed" ? "历史使用" : item.status === "ready" ? "可使用" : item.status}
                    {item.membershipState === "removed" && item.historicalReferenceCount > 0
                      ? ` · 旧版本引用 ${item.historicalReferenceCount} 次`
                      : ""}
                  </small>
                </div>
                <div className="shadcn-prototype-project-resource-actions">
                  {item.kind === "source" ? (
                    <>
                    {item.membershipState === "active" && onUseSourceForNextMessage ? (
                      <button type="button" onClick={() => onUseSourceForNextMessage(item)}>
                        用于本轮
                      </button>
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
                    {onPermanentDeleteSource ? (
                      <details className="shadcn-prototype-project-resource-more">
                        <summary>更多</summary>
                        <button
                          type="button"
                          className="shadcn-prototype-project-source-permanent-delete"
                          disabled={pendingAssetId === item.id}
                          onClick={() => void permanentlyDelete(item)}
                        >
                          永久删除源文件
                        </button>
                      </details>
                    ) : null}
                    </>
                  ) : (
                    <button type="button" onClick={() => onOpenResource(item)}>查看</button>
                  )}
                </div>
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
      <ConfirmationDialog
        open={pendingConfirmation !== null}
        title={pendingConfirmation?.action === "delete" ? "永久删除源文件？" : "将素材移出项目？"}
        description={pendingConfirmation?.action === "delete"
          ? "源文件会从资产库移除。若仍被项目或历史版本引用，系统会拒绝删除。"
          : "这只影响之后的生成；已有文案、封面和视频不会改变。"}
        confirmLabel={pendingConfirmation?.action === "delete" ? "永久删除" : "移出项目"}
        tone={pendingConfirmation?.action === "delete" ? "danger" : "default"}
        busy={pendingAssetId !== null}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => void confirmPendingAction()}
      />
    </>
  );
}
