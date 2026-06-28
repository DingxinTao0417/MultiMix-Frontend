"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  FileText,
  GripVertical,
  House,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video
} from "lucide-react";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import {
  resolveConversationProduct,
  type ActiveView,
  type Conversation,
  type ProductArtifact
} from "../lib/asset-workspace-shared";
import ConversationStart from "./conversation-start";
import ConversationStudio from "./conversation-studio";
import ProductWorkspace from "./product-workspace";
import LibraryWorkshop from "./library-workshop";

type SidebarState = "auto" | "collapsed" | "expanded";

type AssetsWorkspaceClientProps = {
  initialConversationId?: string;
  initialProductId?: string;
  basePath?: string;
  accountEmail?: string;
  token?: string | null;
  onLogout?: () => void;
};

function getConversationMonogram(title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return "聊";

  const firstLatin = trimmedTitle.match(/[A-Za-z0-9]/)?.[0];
  if (firstLatin) return firstLatin.toUpperCase();

  return trimmedTitle[0];
}

function resolveInitialConversationId(initialConversationId: string | undefined, conversations: Conversation[]): string {
  return initialConversationId && conversations.some((conversation) => conversation.id === initialConversationId)
    ? initialConversationId
    : conversations[0].id;
}

export default function AssetsWorkspaceClient({
  initialConversationId,
  initialProductId,
  basePath = "/app/assets",
  accountEmail = "demo@multimix.local",
  token = null,
  onLogout
}: AssetsWorkspaceClientProps) {
  const [conversations, setConversations] = useState<Conversation[]>(() => assetWorkspaceAdapter.listConversations());
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("conversation");
  const [selectedConversationId, setSelectedConversationId] = useState(() => resolveInitialConversationId(initialConversationId, assetWorkspaceAdapter.listConversations()));
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, string>>(() => {
    const conversationId = resolveInitialConversationId(initialConversationId, assetWorkspaceAdapter.listConversations());
    return initialProductId ? { [conversationId]: initialProductId } : {};
  });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const isDividerDraggingRef = useRef(false);
  const [sidebarState, setSidebarState] = useState<SidebarState>("auto");
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(426);
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  const [renamedConversations, setRenamedConversations] = useState<Record<string, string>>({});
  const [hiddenConversationIds, setHiddenConversationIds] = useState<string[]>([]);
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [savedProductIds, setSavedProductIds] = useState<Record<string, string>>({});
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const visibleConversationRows = conversations
    .filter((conversation) => !hiddenConversationIds.includes(conversation.id))
    .map((conversation) => ({
      ...conversation,
      title: renamedConversations[conversation.id] ?? conversation.title
    }));
  const selectedConversation =
    visibleConversationRows.find((conversation) => conversation.id === selectedConversationId) ?? assetWorkspaceAdapter.getNewConversation();
  const selectedProduct = resolveConversationProduct(selectedConversation, selectedProductIds[selectedConversation.id]);
  const isNewConversation = activeView === "conversation" && selectedConversation.id === "new";
  const activeTitle = activeView === "conversation"
    ? "对话创作"
    : assetWorkspaceAdapter.getWorkshop(activeView).title;
  const activeDescription = activeView === "conversation"
    ? ""
    : assetWorkspaceAdapter.getWorkshop(activeView).description;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1180px)");
    const syncViewport = () => setIsNarrowViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    const conversationId = resolveInitialConversationId(initialConversationId, conversations);
    setSelectedConversationId(conversationId);
    if (initialProductId) {
      setSelectedProductIds((current) => ({
        ...current,
        [conversationId]: initialProductId
      }));
    }
    setActiveView("conversation");
    setConversationMenuId(null);
    // conversations intentionally omitted: only re-run when the URL params change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, initialProductId]);

  // Load persisted conversation history from the backend when a token is present.
  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    let cancelled = false;
    void assetWorkspaceAdapter
      .loadConversations(token, assetWorkspaceAdapter.listConversations())
      .then((rows) => {
        if (!cancelled) setConversations(rows);
      })
      .catch(() => {
        toast.error("无法加载对话历史，显示本地样例数据。");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const startDividerResize = (clientX: number) => {
    if (isDividerDraggingRef.current) return;

    const workspaceRect = workspaceRef.current?.getBoundingClientRect();
    if (!workspaceRect) return;

    isDividerDraggingRef.current = true;
    const startX = clientX;
    const startWidth = chatPanelWidth;
    const minChatWidth = 320;
    const minArtifactWidth = 360;
    const handleWidth = 10;
    const maxChatWidth = Math.max(minChatWidth, workspaceRect.width - minArtifactWidth - handleWidth);
    document.body.classList.add("shadcn-prototype-resizing");

    const handleResizeMove = (moveEvent: PointerEvent | MouseEvent) => {
      const nextWidth = Math.min(maxChatWidth, Math.max(minChatWidth, startWidth + moveEvent.clientX - startX));
      setChatPanelWidth(Math.round(nextWidth));
    };

    const stopDividerResize = () => {
      isDividerDraggingRef.current = false;
      document.body.classList.remove("shadcn-prototype-resizing");
      window.removeEventListener("pointermove", handleResizeMove);
      window.removeEventListener("pointerup", stopDividerResize);
      window.removeEventListener("pointercancel", stopDividerResize);
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", stopDividerResize);
    };

    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", stopDividerResize);
    window.addEventListener("pointercancel", stopDividerResize);
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", stopDividerResize);
  };

  const adjustDividerWidth = (delta: number) => {
    const workspaceRect = workspaceRef.current?.getBoundingClientRect();
    const minChatWidth = 320;
    const minArtifactWidth = 360;
    const handleWidth = 10;
    const maxChatWidth = workspaceRect
      ? Math.max(minChatWidth, workspaceRect.width - minArtifactWidth - handleWidth)
      : 640;
    setChatPanelWidth((current) => Math.min(maxChatWidth, Math.max(minChatWidth, current + delta)));
  };

  const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some automation/browser layers do not expose pointer capture; mouse events still handle resize.
    }
    startDividerResize(event.clientX);
  };

  const handleDividerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    startDividerResize(event.clientX);
  };

  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      adjustDividerWidth(event.shiftKey ? -80 : -32);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      adjustDividerWidth(event.shiftKey ? 80 : 32);
    }
  };

  const handleRenameConversation = (conversation: Conversation) => {
    setRenamedConversations((current) => ({
      ...current,
      [conversation.id]: `${conversation.title.replace("（已重命名）", "")}（已重命名）`
    }));
    setConversationMenuId(null);
  };

  const handleDeleteConversation = (conversationId: string) => {
    const nextConversation = visibleConversationRows.find((conversation) => conversation.id !== conversationId);
    setHiddenConversationIds((current) => [...current, conversationId]);
    if (selectedConversationId === conversationId) {
      setSelectedConversationId(nextConversation?.id ?? "new");
      setActiveView("conversation");
    }
    setConversationMenuId(null);
  };

  const handleCollapseSidebar = () => {
    setSidebarState("collapsed");
  };

  const handleExpandSidebar = () => {
    setSidebarState("expanded");
  };

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setActiveView("conversation");
    setConversationMenuId(null);
  };

  const handleSelectProduct = (conversationId: string, productId: string) => {
    setSelectedProductIds((current) => ({
      ...current,
      [conversationId]: productId
    }));
  };

  const handleCopyProduct = async (product: ProductArtifact) => {
    const text = assetWorkspaceAdapter.getProductText(product);
    setCopiedProductId(product.id);
    window.setTimeout(() => {
      setCopiedProductId((current) => current === product.id ? null : current);
    }, 1400);
    try {
      await navigator.clipboard.writeText(text);
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
    }
  };

  const handleSaveProduct = async (product: ProductArtifact) => {
    try {
      const result = await assetWorkspaceAdapter.saveProduct(product, token);
      setSavedProductIds((current) => ({
        ...current,
        [product.id]: result.version
      }));
      toast.success("已保存");
    } catch {
      toast.error("保存失败，请稍后重试。");
    }
  };

  const handleStartConversation = async () => {
    setActiveView("conversation");
    setConversationMenuId(null);
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setSelectedConversationId("new");
      return;
    }
    if (creatingConversation) return;
    setCreatingConversation(true);
    try {
      const conversation = await assetWorkspaceAdapter.createConversation(token);
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setSelectedConversationId(conversation.id);
      setSelectedProductIds((current) => {
        const next = { ...current };
        delete next.new;
        return next;
      });
    } catch {
      setSelectedConversationId("new");
      toast.error("创建对话失败，请稍后重试。");
    } finally {
      setCreatingConversation(false);
    }
  };

  const handleSendConversationMessage = async (conversation: Conversation, instruction: string, signal?: AbortSignal) => {
    if (conversation.readonly) {
      throw new Error("参考样例只读，不能继续对话。");
    }
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      throw new Error("请先登录并配置后端后再使用 AI 生成。");
    }
    const selectedBackendAssetId = selectedProduct.backendAssetId;
    const result = await assetWorkspaceAdapter.sendMessage({
      token,
      conversationId: conversation.id,
      instruction,
      selectedProductId: selectedBackendAssetId,
      signal
    });
    if (signal?.aborted) return;
    const { conversationId: targetConversationId, conversation: persistedConversation, product } = result;
    setConversations((current) => {
      const existingIndex = current.findIndex((item) => item.id === conversation.id || item.id === targetConversationId);
      if (existingIndex >= 0) {
        return current.map((item, index) => index === existingIndex ? persistedConversation : item);
      }
      return [persistedConversation, ...current];
    });
    setSelectedConversationId(targetConversationId);
    setSelectedProductIds((current) => ({
      ...current,
      [targetConversationId]: product.id
    }));
    setActiveView("conversation");
  };

  const handleUploadClick = () => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setUploadError("请先登录并配置后端后再上传资料。");
      return;
    }
    setUploadError(null);
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (file: File | undefined) => {
    if (!file || !token) return;
    setUploading(true);
    setUploadError(null);
    try {
      await assetWorkspaceAdapter.uploadAsset(token, file);
      setLibraryRefreshKey((value) => value + 1);
      setActiveView("assets");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "上传失败，请稍后重试。";
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const isSidebarVisuallyCollapsed = sidebarState === "auto" && isNarrowViewport;

  const shellClassName = [
    "shadcn-prototype-shell",
    sidebarState === "collapsed" ? "sidebar-collapsed" : "",
    sidebarState === "expanded" ? "sidebar-expanded" : "",
    isSidebarVisuallyCollapsed ? "sidebar-visual-collapsed" : ""
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClassName}>
      <aside className="shadcn-prototype-sidebar" aria-label="Workspace navigation">
        <div className="shadcn-prototype-team">
          <Link className="shadcn-prototype-home" href="/" aria-label="返回主页" title="返回主页">
            <House size={16} aria-hidden="true" />
          </Link>
          <div className="shadcn-prototype-brand">
            <strong>MultiMix</strong>
          </div>
          <button
            className="shadcn-prototype-sidebar-toggle"
            type="button"
            aria-label="隐藏侧边栏"
            title="隐藏侧边栏"
            onClick={handleCollapseSidebar}
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="shadcn-prototype-collapsed-rail" aria-label="收起导航">
          <div className="shadcn-prototype-collapsed-rail-group">
            <button
              className="shadcn-prototype-collapsed-rail-button"
              type="button"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              onClick={handleExpandSidebar}
            >
              <PanelLeftOpen size={17} aria-hidden="true" />
            </button>
            <Link className="shadcn-prototype-collapsed-rail-button" href="/" aria-label="返回主页" title="返回主页">
              <House size={17} aria-hidden="true" />
            </Link>
          </div>

          <div className="shadcn-prototype-collapsed-rail-group">
            <button
              className={activeView === "conversation" && selectedConversation.id === "new" ? "shadcn-prototype-collapsed-rail-button active accent" : "shadcn-prototype-collapsed-rail-button accent"}
              type="button"
              aria-label="新建创作"
              title="新建创作"
              onClick={() => {
                void handleStartConversation();
              }}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <button
              className="shadcn-prototype-collapsed-rail-button"
              type="button"
              aria-label="搜索聊天"
              title="搜索聊天"
            >
              <Search size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="shadcn-prototype-collapsed-rail-group">
            <button
              className={activeView === "assets" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="资产库"
              title="资产库"
              onClick={() => setActiveView("assets")}
            >
              <FileText size={17} aria-hidden="true" />
            </button>
            <button
              className={activeView === "copy" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="文案库"
              title="文案库"
              onClick={() => setActiveView("copy")}
            >
              <MessageSquareText size={17} aria-hidden="true" />
            </button>
            <button
              className={activeView === "video" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="视频库"
              title="视频库"
              onClick={() => setActiveView("video")}
            >
              <Video size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="shadcn-prototype-collapsed-rail-user" aria-label="账户">
            <span title={accountEmail}>{getConversationMonogram(accountEmail)}</span>
          </div>
        </div>

        <button className="shadcn-prototype-search" type="button">
          <Search size={15} aria-hidden="true" />
          <span>搜索素材、产物或来源</span>
        </button>

        <button
          className={activeView === "conversation" && selectedConversation.id === "new" ? "shadcn-prototype-new-conversation active" : "shadcn-prototype-new-conversation"}
          type="button"
          disabled={creatingConversation}
          onClick={() => {
            void handleStartConversation();
          }}
        >
          <Sparkles size={15} aria-hidden="true" />
          新建创作
        </button>

        <nav className="shadcn-prototype-nav" aria-label="Primary">
          <button className={activeView === "assets" ? "active" : ""} type="button" onClick={() => setActiveView("assets")}>
            <FileText size={16} aria-hidden="true" />
            资产库
          </button>
          <button className={activeView === "copy" ? "active" : ""} type="button" onClick={() => setActiveView("copy")}>
            <MessageSquareText size={16} aria-hidden="true" />
            文案库
          </button>
          <button className={activeView === "video" ? "active" : ""} type="button" onClick={() => setActiveView("video")}>
            <Video size={16} aria-hidden="true" />
            视频库
          </button>
        </nav>

        <div className="shadcn-prototype-conversation-section">
          <div className="shadcn-prototype-section-title">
            <span>对话列表</span>
            <em>{visibleConversationRows.length}</em>
          </div>
          <div className="shadcn-prototype-conversation-list">
            {visibleConversationRows.map((conversation) => (
              <div
                className={activeView === "conversation" && conversation.id === selectedConversation.id ? "shadcn-prototype-conversation-row active" : "shadcn-prototype-conversation-row"}
                key={conversation.id}
              >
                <Link
                  className="shadcn-prototype-conversation-main"
                  href={`${basePath}?conversation=${encodeURIComponent(conversation.id)}`}
                  aria-current={activeView === "conversation" && conversation.id === selectedConversation.id ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    handleSelectConversation(conversation.id);
                  }}
                >
                  <strong title={conversation.title}>{conversation.title}</strong>
                  <span>{conversation.updatedAt}</span>
                </Link>
                <button
                  className="shadcn-prototype-conversation-more"
                  type="button"
                  aria-label={`${conversation.title} 更多操作`}
                  aria-expanded={conversationMenuId === conversation.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setConversationMenuId((current) => current === conversation.id ? null : conversation.id);
                  }}
                >
                  <MoreHorizontal size={15} aria-hidden="true" />
                </button>
                {conversationMenuId === conversation.id ? (
                  <div className="shadcn-prototype-conversation-menu" onClick={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => handleRenameConversation(conversation)}>
                      <Pencil size={13} aria-hidden="true" />
                      重命名
                    </button>
                    <button type="button" onClick={() => handleDeleteConversation(conversation.id)}>
                      <Trash2 size={13} aria-hidden="true" />
                      删除对话
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="shadcn-prototype-user">
          <div>
            <strong>{accountEmail}</strong>
            {onLogout ? (
              <button type="button" className="shadcn-prototype-logout" onClick={onLogout}>退出登录</button>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="shadcn-prototype-inset">
        <header className="shadcn-prototype-topbar">
          {sidebarState === "auto" && isNarrowViewport ? (
            <button
              className="shadcn-prototype-topbar-sidebar-toggle"
              type="button"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              onClick={handleExpandSidebar}
            >
              <PanelLeftOpen size={16} aria-hidden="true" />
            </button>
          ) : null}
          <div className="shadcn-prototype-breadcrumb">
            <strong>{activeTitle}</strong>
            {activeDescription ? <span>{activeDescription}</span> : null}
          </div>
          <div className="shadcn-prototype-actions">
            {activeView !== "conversation" ? (
              <>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".md,.markdown,.pdf,.xlsx,.xlsm,.docx,.pptx,.html,.htm"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    void handleUploadFile(event.currentTarget.files?.[0]);
                  }}
                />
                <button type="button" onClick={handleUploadClick} disabled={uploading}>
                  <Upload size={15} aria-hidden="true" />
                  {uploading ? "上传中..." : "上传资产"}
                </button>
                {uploadError ? <span className="shadcn-prototype-upload-error" role="alert">{uploadError}</span> : null}
              </>
            ) : null}
          </div>
        </header>

        <div
          ref={workspaceRef}
          className={
            isNewConversation
              ? "shadcn-prototype-workspace empty-mode"
              : activeView === "conversation"
                ? "shadcn-prototype-workspace conversation-mode"
                : "shadcn-prototype-workspace workshop-mode"
          }
          style={!isNewConversation && activeView === "conversation"
            ? { "--chat-panel-width": `${chatPanelWidth}px` } as CSSProperties
            : undefined}
        >
          {isNewConversation ? (
            <ConversationStart
              suggestions={selectedConversation.suggestions ?? []}
              conversation={selectedConversation}
              onSend={handleSendConversationMessage}
            />
          ) : activeView === "conversation" ? (
            <>
              <ConversationStudio
                basePath={basePath}
                selectedConversation={selectedConversation}
                selectedProduct={selectedProduct}
                onSelectProduct={handleSelectProduct}
                onSendMessage={handleSendConversationMessage}
                readonly={selectedConversation.readonly ?? false}
              />
              <div
                className="shadcn-prototype-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-valuemin={320}
                aria-valuenow={chatPanelWidth}
                aria-label="调整对话和展示区宽度"
                tabIndex={0}
                title="拖动调整宽度"
                onPointerDown={handleDividerPointerDown}
                onMouseDown={handleDividerMouseDown}
                onKeyDown={handleDividerKeyDown}
              >
                <GripVertical size={14} aria-hidden="true" />
              </div>
              <ProductWorkspace
                copied={copiedProductId === selectedProduct.id}
                onCopyProduct={handleCopyProduct}
                onSaveProduct={handleSaveProduct}
                onRenderVideo={async (product) => {
                  if (!token || !product.backendAssetId) return;
                  await assetWorkspaceAdapter.renderVideo(token, product.backendAssetId);
                }}
                product={selectedProduct}
                savedVersion={savedProductIds[selectedProduct.id]}
                selectedConversation={selectedConversation}
              />
            </>
          ) : (
            <LibraryWorkshop view={activeView} token={token} key={`${activeView}-${libraryRefreshKey}`} />
          )}
        </div>
      </section>
    </main>
  );
}
