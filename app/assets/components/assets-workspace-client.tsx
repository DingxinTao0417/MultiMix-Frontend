"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  FileText,
  Gauge,
  GripVertical,
  House,
  Image as ImageIcon,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Video
} from "lucide-react";
import { getAssetLlmDiagnostics, type AssetLlmDiagnosticsRead } from "../../../lib/api";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import {
  resolveConversationProduct,
  type ActiveView,
  type Conversation,
  type ProductArtifact
} from "../lib/asset-workspace-shared";
import dynamic from "next/dynamic";
import ConversationStart from "./conversation-start";
import ConversationStudio from "./conversation-studio";
import type { LibraryActionIntent } from "./library-workshop";

// Split the heavy panels (react-markdown pipeline, library views) out of the
// initial bundle; only the active view's chunk is fetched. Auth gating already
// makes this subtree client-only, so ssr: false loses nothing.
const ProductWorkspace = dynamic(() => import("./product-workspace"), { ssr: false, loading: () => null });
const EmptyProductWorkspace = dynamic(
  () => import("./product-workspace").then((mod) => ({ default: mod.EmptyProductWorkspace })),
  { ssr: false, loading: () => null }
);
const LibraryWorkshop = dynamic(() => import("./library-workshop"), { ssr: false, loading: () => null });

type SidebarState = "auto" | "collapsed" | "expanded";
type DiagnosticsState = {
  open: boolean;
  loading: boolean;
  data: AssetLlmDiagnosticsRead | null;
  error: string | null;
};

type AssetsWorkspaceClientProps = {
  initialConversationId?: string;
  initialProductId?: string;
  basePath?: string;
  accountEmail?: string;
  token?: string | null;
  onLogout?: () => void;
};

type ConversationContextAsset = {
  id: number;
  title: string;
};

type PendingConversationExchange = {
  id: string;
  userText: string;
  assistantText: string;
  status: "pending" | "stopped" | "failed";
};

function pendingVideoJobIds(conversations: Conversation[]): string[] {
  const ids = new Set<string>();
  for (const conversation of conversations) {
    const products = conversation.products && conversation.products.length > 0 ? conversation.products : [conversation.product];
    for (const product of products) {
      const metadata = product.metadata as Record<string, unknown> | undefined;
      const jobId = metadata?.latest_job_public_id;
      const pending = Boolean(metadata?.orchestration_pending && !metadata?.video_project && typeof jobId === "string");
      if (pending && typeof jobId === "string") ids.add(jobId);
    }
  }
  return [...ids];
}

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

function uploadAcceptForView(view: ActiveView): string {
  if (view === "copy") return ".txt,.md,.markdown,.pdf,.docx,.html,.htm";
  if (view === "image") return ".png,.jpg,.jpeg,.webp,.gif";
  if (view === "video") return ".mp4,.mov,.webm,.mkv";
  return ".md,.markdown,.pdf,.xlsx,.xlsm,.docx,.pptx,.html,.htm,.txt";
}

function shouldReviseSelectedProduct(instruction: string, product: ProductArtifact | null): boolean {
  if (!product?.backendAssetId) return false;
  const text = instruction.trim().toLowerCase();
  if (!text) return false;
  if (/(mp4|成片|渲染|导出视频|render|export)/i.test(text)) return false;
  if (/(再做|另外|新增|新建|再生成|另做|add another|new one|create another)/i.test(text)) return false;
  if (/(基于|做成|变成|转成|turn into|make it).*(文案|图片|图|视频|copy|image|video)/i.test(text)) return false;
  return /(短一点|更短|缩短|压到|改写|重写|优化|删掉|保留|第二|镜头|字幕|口语|专业|构图|色调|shorten|revise|rewrite|edit)/i.test(text);
}

function mergeContextAssets(current: ConversationContextAsset[], additions: ConversationContextAsset[]): ConversationContextAsset[] {
  const byId = new Map<number, ConversationContextAsset>();
  for (const item of [...current, ...additions]) {
    byId.set(item.id, item);
  }
  return [...byId.values()].slice(-8);
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
  const [activeView, setActiveView] = useState<ActiveView>("conversation");
  const [selectedConversationId, setSelectedConversationId] = useState(() => resolveInitialConversationId(initialConversationId, assetWorkspaceAdapter.listConversations()));
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, string>>(() => {
    const conversationId = resolveInitialConversationId(initialConversationId, assetWorkspaceAdapter.listConversations());
    return initialProductId ? { [conversationId]: initialProductId } : {};
  });
  const selectedConversationIdRef = useRef(selectedConversationId);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const isDividerDraggingRef = useRef(false);
  const [sidebarState, setSidebarState] = useState<SidebarState>("auto");
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(426);
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  const [renamedConversations, setRenamedConversations] = useState<Record<string, string>>({});
  const [pendingConversationExchanges, setPendingConversationExchanges] = useState<Record<string, PendingConversationExchange>>({});
  const [hiddenConversationIds, setHiddenConversationIds] = useState<string[]>([]);
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [savedProductIds, setSavedProductIds] = useState<Record<string, string>>({});
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [conversationContextAssets, setConversationContextAssets] = useState<Record<string, ConversationContextAsset[]>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({
    open: false,
    loading: false,
    data: null,
    error: null
  });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const visibleConversationRows = useMemo(() => conversations
    .filter((conversation) => !hiddenConversationIds.includes(conversation.id))
    .map((conversation) => ({
      ...conversation,
      title: renamedConversations[conversation.id] ?? conversation.title
    })), [conversations, hiddenConversationIds, renamedConversations]);
  const selectedConversation =
    visibleConversationRows.find((conversation) => conversation.id === selectedConversationId) ?? assetWorkspaceAdapter.getNewConversation();
  const selectedProduct = resolveConversationProduct(selectedConversation, selectedProductIds[selectedConversation.id]);
  const currentContextAssets = conversationContextAssets[selectedConversation.id] ?? [];
  const isNewConversation = activeView === "conversation" && selectedConversation.id === "new";
  const canShowDiagnostics = process.env.NODE_ENV !== "production" || accountEmail.endsWith("@multimix.local") || accountEmail.includes("+admin");
  const activeTitle = activeView === "conversation"
    ? "对话"
    : assetWorkspaceAdapter.getWorkshop(activeView).title;
  const activeDescription = activeView === "conversation"
    ? ""
    : assetWorkspaceAdapter.getWorkshop(activeView).description;

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1180px)");
    const syncViewport = () => setIsNarrowViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  // Close conversation menu when clicking anywhere outside it.
  useEffect(() => {
    if (!conversationMenuId) return;
    const handleClick = () => setConversationMenuId(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [conversationMenuId]);

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

  // Poll all orchestration jobs that are still building. These jobs run in the
  // background, so their visible pending state must survive conversation switches.
  // Keyed on the joined job-id string (not the conversations array) so unrelated
  // conversation updates don't tear down and restart the interval.
  const pendingVideoJobKey = useMemo(() => pendingVideoJobIds(conversations).join(","), [conversations]);
  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    const jobIds = pendingVideoJobKey ? pendingVideoJobKey.split(",") : [];
    if (!jobIds.length) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const results = await Promise.allSettled(jobIds.map((jobId) => assetWorkspaceAdapter.getVideoJob(token, jobId)));
        if (cancelled) return;
        const finished = results.some((result) => (
          result.status === "fulfilled"
          && (result.value.status === "completed" || result.value.status === "failed")
        ));
        if (finished) {
          clearInterval(timer);
          const rows = await assetWorkspaceAdapter.loadConversations(token, assetWorkspaceAdapter.listConversations());
          if (!cancelled) setConversations(rows);
          const failed = results.some((result) => result.status === "fulfilled" && result.value.status === "failed");
          if (failed) toast.error("视频生成失败，请重试或调整指令。");
        }
      } catch {
        // transient poll error; keep trying until cleared
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, pendingVideoJobKey]);

  const startDividerResize = (clientX: number) => {
    if (isDividerDraggingRef.current) return;

    const workspaceRect = workspaceRef.current?.getBoundingClientRect();
    if (!workspaceRect) return;

    isDividerDraggingRef.current = true;
    const startX = clientX;
    const startWidth = chatPanelWidth;
    let latestWidth = startWidth;
    const minChatWidth = 320;
    const minArtifactWidth = 360;
    const handleWidth = 10;
    const maxChatWidth = Math.max(minChatWidth, workspaceRect.width - minArtifactWidth - handleWidth);
    document.body.classList.add("shadcn-prototype-resizing");

    const handleResizeMove = (moveEvent: PointerEvent | MouseEvent) => {
      const nextWidth = Math.min(maxChatWidth, Math.max(minChatWidth, startWidth + moveEvent.clientX - startX));
      latestWidth = Math.round(nextWidth);
      // Write the CSS var imperatively during the drag; committing React state
      // per pointermove re-renders the whole workspace tree dozens of times/sec.
      workspaceRef.current?.style.setProperty("--chat-panel-width", `${latestWidth}px`);
    };

    const stopDividerResize = () => {
      isDividerDraggingRef.current = false;
      document.body.classList.remove("shadcn-prototype-resizing");
      window.removeEventListener("pointermove", handleResizeMove);
      window.removeEventListener("pointerup", stopDividerResize);
      window.removeEventListener("pointercancel", stopDividerResize);
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", stopDividerResize);
      setChatPanelWidth(latestWidth);
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

  const updateConversationProduct = (conversationId: string, updatedProduct: ProductArtifact) => {
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const products = conversation.products ?? [conversation.product];
      const nextProducts = products.some((item) => item.id === updatedProduct.id)
        ? products.map((item) => item.id === updatedProduct.id ? updatedProduct : item)
        : [...products, updatedProduct];
      return {
        ...conversation,
        product: conversation.product.id === updatedProduct.id ? updatedProduct : conversation.product,
        products: nextProducts,
        canvasTitle: updatedProduct.title,
        canvasMeta: `${updatedProduct.status} · ${updatedProduct.ratio}`,
        raw: updatedProduct.body?.join("\n\n") ?? updatedProduct.summary,
        updatedAt: "刚刚"
      };
    }));
  };

  const handleRestoreProductVersion = async (product: ProductArtifact, versionId: string) => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      toast.error("请先登录并配置后端后再恢复版本。");
      return;
    }
    try {
      const result = await assetWorkspaceAdapter.restoreProductVersion({ token, product, versionId });
      updateConversationProduct(selectedConversation.id, result.product);
      setSavedProductIds((current) => ({
        ...current,
        [result.product.id]: result.product.version ?? result.diffSummary
      }));
      toast.success(result.assistantMessage || "已恢复版本");
    } catch {
      toast.error("恢复失败，请稍后重试。");
    }
  };

  const handleStartConversation = () => {
    setActiveView("conversation");
    setConversationMenuId(null);
    setSelectedConversationId("new");
  };

  const handleAddAssetToConversation = (row: LibraryRow) => {
    if (!row.assetId) {
      toast.error("这个条目还没有后端资产 ID。");
      return;
    }
    const targetConversationId = selectedConversation.readonly ? "new" : selectedConversation.id;
    setConversationContextAssets((current) => ({
      ...current,
      [targetConversationId]: mergeContextAssets(current[targetConversationId] ?? [], [{ id: row.assetId!, title: row.title }])
    }));
    setSelectedConversationId(targetConversationId);
    setActiveView("conversation");
    toast.success("已加入当前对话引用。");
  };

  const handleUseLibraryAsset = async (row: LibraryRow, intent: LibraryActionIntent) => {
    if (!row.assetId) {
      toast.error("这个条目还没有后端资产 ID。");
      return;
    }
    const linkedAsset = { id: row.assetId, title: row.title };
    const targetConversation = assetWorkspaceAdapter.getNewConversation();
    const instruction = intent === "video"
      ? `基于《${row.title}》做成视频。`
      : intent === "regenerate-image"
        ? `基于《${row.title}》做成图片。`
        : `基于《${row.title}》做成文案。`;
    setConversationContextAssets((current) => ({
      ...current,
      [targetConversation.id]: [linkedAsset]
    }));
    setSelectedConversationId(targetConversation.id);
    setActiveView("conversation");
    try {
      await handleSendConversationMessage(targetConversation, instruction, undefined, [linkedAsset]);
      toast.success("已基于资产发起创作。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发起创作失败。");
    }
  };

  const handleSendConversationMessage = async (conversation: Conversation, instruction: string, signal?: AbortSignal, linkedAssets: ConversationContextAsset[] = []) => {
    if (conversation.readonly) {
      throw new Error("参考样例只读，不能继续对话。");
    }
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      throw new Error("请先登录并配置后端后再使用 AI 生成。");
    }
    const selectedBackendAssetId = selectedProduct?.backendAssetId;
    const contextAssets = linkedAssets.length > 0 ? [] : conversationContextAssets[conversation.id] ?? [];
    const combinedContextAssets = mergeContextAssets(contextAssets, linkedAssets);
    const combinedLinkedAssetIds = combinedContextAssets.map((asset) => asset.id);
    const optimisticConversationId = conversation.id === "new"
      ? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : null;
    if (optimisticConversationId) {
      const baseConversation = assetWorkspaceAdapter.getNewConversation();
      const optimisticConversation: Conversation = {
        ...baseConversation,
        id: optimisticConversationId,
        readonly: false,
        title: instruction.slice(0, 36) || "新建对话",
        updatedAt: "刚刚",
        assetLabel: "生成中",
        status: "生成中",
        prompt: instruction,
        response: "",
        delivery: "",
        suggestions: [],
        messages: [
          { role: "user", text: instruction },
          { role: "assistant", text: "", pending: true }
        ],
      };
      setConversations((current) => [
        optimisticConversation,
        ...current.filter((item) => item.id !== "new" && item.id !== optimisticConversationId)
      ]);
      selectedConversationIdRef.current = optimisticConversationId;
      setSelectedConversationId(optimisticConversationId);
      setActiveView("conversation");
      setConversationMenuId(null);
      if (combinedContextAssets.length > 0) {
        setConversationContextAssets((current) => ({
          ...current,
          [optimisticConversationId]: combinedContextAssets
        }));
      }
    }
    if (selectedProduct && shouldReviseSelectedProduct(instruction, selectedProduct)) {
      const revision = await assetWorkspaceAdapter.reviseProduct({
        token,
        product: selectedProduct,
        conversationId: conversation.id,
        instruction,
        signal
      });
      if (signal?.aborted) return;
      const updatedProduct = revision.product;
      setConversations((current) => current.map((item) => {
        if (item.id !== conversation.id) return item;
        const products = item.products ?? [item.product];
        const nextProducts = products.some((product) => product.id === updatedProduct.id)
          ? products.map((product) => product.id === updatedProduct.id ? updatedProduct : product)
          : [...products, updatedProduct];
        const nextMessages = [
          ...(item.messages ?? []),
          { role: "user" as const, text: instruction },
          {
            role: "assistant" as const,
            text: revision.assistantMessage,
            suggestions: revision.suggestions,
            suggestionActions: revision.suggestionActions
          }
        ];
        return {
          ...item,
          product: updatedProduct,
          products: nextProducts,
          messages: nextMessages,
          prompt: instruction,
          response: revision.assistantMessage,
          suggestions: revision.suggestions,
          status: updatedProduct.status,
          canvasTitle: updatedProduct.title,
          canvasMeta: `${updatedProduct.status} · ${updatedProduct.ratio}`,
          raw: updatedProduct.body?.join("\n\n") ?? updatedProduct.summary,
          updatedAt: "刚刚"
        };
      }));
      setSelectedProductIds((current) => ({
        ...current,
        [conversation.id]: updatedProduct.id
      }));
      setSavedProductIds((current) => ({
        ...current,
        [updatedProduct.id]: updatedProduct.version ?? revision.diffSummary
      }));
      setActiveView("conversation");
      return;
    }
    let result;
    try {
      result = await assetWorkspaceAdapter.sendMessage({
        token,
        conversationId: optimisticConversationId ?? conversation.id,
        instruction,
        selectedProductId: combinedLinkedAssetIds.length > 0 ? undefined : selectedBackendAssetId,
        linkedAssetIds: combinedLinkedAssetIds,
        signal
      });
    } catch (error) {
      if (optimisticConversationId && !signal?.aborted) {
        const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
        setConversations((current) => current.map((item) => {
          if (item.id !== optimisticConversationId) return item;
          return {
            ...item,
            status: "生成失败",
            response: message,
            delivery: message,
            messages: [
              { role: "user", text: instruction },
              { role: "assistant", text: message }
            ],
            updatedAt: "刚刚"
          };
        }));
      }
      throw error;
    }
    if (signal?.aborted) return;
    const { conversationId: targetConversationId, conversation: persistedConversation, product } = result;
    setConversations((current) => {
      const existingIndex = current.findIndex((item) => item.id === (optimisticConversationId ?? conversation.id) || item.id === conversation.id || item.id === targetConversationId);
      if (existingIndex >= 0) {
        return current.map((item, index) => index === existingIndex ? persistedConversation : item);
      }
      return [persistedConversation, ...current];
    });
    const shouldKeepFocusOnResult = selectedConversationIdRef.current === (optimisticConversationId ?? conversation.id);
    if (shouldKeepFocusOnResult) {
      selectedConversationIdRef.current = targetConversationId;
      setSelectedConversationId(targetConversationId);
    }
    if (targetConversationId !== conversation.id && combinedLinkedAssetIds.length > 0) {
      setConversationContextAssets((current) => {
        const next = { ...current };
        next[targetConversationId] = mergeContextAssets(next[targetConversationId] ?? [], combinedContextAssets);
        if (conversation.id === "new") delete next[conversation.id];
        if (optimisticConversationId) delete next[optimisticConversationId];
        return next;
      });
    }
    setSelectedProductIds((current) => {
      if (product) {
        return {
          ...current,
          [targetConversationId]: product.id
        };
      }
      const next = { ...current };
      delete next[targetConversationId];
      return next;
    });
    if (shouldKeepFocusOnResult) {
      setActiveView("conversation");
    }
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
    if (!file || !token || activeView === "conversation") return;
    setUploading(true);
    setUploadError(null);
    try {
      await assetWorkspaceAdapter.uploadAsset(token, file, activeView);
      setLibraryRefreshKey((value) => value + 1);
      setActiveView(activeView);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "上传失败，请稍后重试。";
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const handleToggleDiagnostics = async () => {
    if (diagnostics.open) {
      setDiagnostics((current) => ({ ...current, open: false }));
      return;
    }
    setDiagnostics((current) => ({ ...current, open: true, loading: true, error: null }));
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setDiagnostics({ open: true, loading: false, data: null, error: "后端未连接" });
      return;
    }
    try {
      const data = await getAssetLlmDiagnostics(token, true);
      setDiagnostics({ open: true, loading: false, data, error: null });
    } catch {
      setDiagnostics({ open: true, loading: false, data: null, error: "诊断失败" });
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
              aria-label="新建对话"
              title="新建对话"
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
              className={activeView === "image" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="图片库"
              title="图片库"
              onClick={() => setActiveView("image")}
            >
              <ImageIcon size={17} aria-hidden="true" />
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
          onClick={() => {
            void handleStartConversation();
          }}
        >
          <Sparkles size={15} aria-hidden="true" />
          新建对话
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
          <button className={activeView === "image" ? "active" : ""} type="button" onClick={() => setActiveView("image")}>
            <ImageIcon size={16} aria-hidden="true" />
            图片库
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
            {canShowDiagnostics ? <div className="shadcn-prototype-diagnostics">
              <button
                type="button"
                aria-expanded={diagnostics.open}
                aria-controls="llm-diagnostics-panel"
                onClick={() => {
                  void handleToggleDiagnostics();
                }}
              >
                <Gauge size={15} aria-hidden="true" />
                诊断
              </button>
              {diagnostics.open ? (
                <aside id="llm-diagnostics-panel" className="shadcn-prototype-diagnostics-panel" aria-label="LLM 诊断">
                  <header>
                    <span>LLM 诊断</span>
                    <strong>
                      {diagnostics.loading
                        ? "检测中"
                        : diagnostics.data?.configured
                          ? "已配置"
                          : "未配置"}
                    </strong>
                  </header>
                  {diagnostics.error ? <p role="alert">{diagnostics.error}</p> : null}
                  {diagnostics.data ? (
                    <dl>
                      <div>
                        <dt>Provider</dt>
                        <dd>{diagnostics.data.provider}</dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        <dd>{diagnostics.data.model ?? "未设置"}</dd>
                      </div>
                      <div>
                        <dt>Probe</dt>
                        <dd>{diagnostics.data.probe_ok === true ? "正常" : diagnostics.data.probe_ok === false ? "失败" : "未执行"}</dd>
                      </div>
                      <div>
                        <dt>Timeout</dt>
                        <dd>{diagnostics.data.timeout_seconds}s</dd>
                      </div>
                    </dl>
                  ) : null}
                  {diagnostics.data?.probe_error ? <p role="status">{diagnostics.data.probe_error}</p> : null}
                </aside>
              ) : null}
            </div> : null}
            <input
              ref={uploadInputRef}
              type="file"
              accept={uploadAcceptForView(activeView)}
              style={{ display: "none" }}
              onChange={(event) => {
                void handleUploadFile(event.currentTarget.files?.[0]);
              }}
            />
            {uploadError ? <span className="shadcn-prototype-upload-error" role="alert">{uploadError}</span> : null}
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
                contextAssets={currentContextAssets}
                selectedConversation={selectedConversation}
                selectedProduct={selectedProduct}
                onSelectProduct={handleSelectProduct}
                pendingExchange={pendingConversationExchanges[selectedConversation.id] ?? null}
                onPendingExchangeChange={(conversationId, exchange) => {
                  setPendingConversationExchanges((current) => {
                    const next = { ...current };
                    if (exchange) {
                      next[conversationId] = exchange;
                    } else {
                      delete next[conversationId];
                    }
                    return next;
                  });
                }}
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
              {selectedProduct ? (
                <ProductWorkspace
                  copied={copiedProductId === selectedProduct.id}
                  onCopyProduct={handleCopyProduct}
                  onSaveProduct={handleSaveProduct}
                  onRestoreVersion={handleRestoreProductVersion}
                  onProductUpdated={(updatedProduct) => {
                    setConversations((current) => current.map((conversation) => {
                      if (conversation.id !== selectedConversation.id) return conversation;
                      const products = conversation.products ?? [conversation.product];
                      const nextProducts = products.some((item) => item.id === updatedProduct.id)
                        ? products.map((item) => item.id === updatedProduct.id ? updatedProduct : item)
                        : [...products, updatedProduct];
                      return {
                        ...conversation,
                        product: conversation.product.id === updatedProduct.id ? updatedProduct : conversation.product,
                        products: nextProducts,
                        canvasTitle: updatedProduct.title,
                        canvasMeta: `${updatedProduct.status} · ${updatedProduct.ratio}`,
                        raw: updatedProduct.body?.join("\n\n") ?? updatedProduct.summary,
                        updatedAt: "刚刚"
                      };
                    }));
                  }}
                  product={selectedProduct}
                  savedVersion={savedProductIds[selectedProduct.id]}
                  selectedConversation={selectedConversation}
                  token={token}
                />
              ) : (
                <EmptyProductWorkspace />
              )}
            </>
          ) : (
            <LibraryWorkshop
              view={activeView}
              token={token}
              key={`${activeView}-${libraryRefreshKey}`}
              onUploadClick={handleUploadClick}
              uploading={uploading}
              onUseAsset={handleUseLibraryAsset}
              onAddAssetToConversation={handleAddAssetToConversation}
            />
          )}
        </div>
      </section>
    </main>
  );
}
