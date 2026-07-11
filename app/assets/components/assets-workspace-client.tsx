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
  LogOut,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
  Video
} from "lucide-react";
import { API_CONNECTION_ERROR, formatComposerError, getAssetLlmDiagnostics, MESSAGE_NOT_SUBMITTED_ERROR, type AssetLlmDiagnosticsRead } from "../../../lib/api";
import { agentTimelineStepsFromBackend, videoJobTimelineSteps } from "../../../lib/asset-mappers";
import { assetWorkspaceAdapter, type LibraryRow, type VideoJobResult, type VideoJobStepResult } from "../lib/asset-workspace-adapter";
import type { AgentRunStep } from "../lib/asset-workspace-types";
import {
  resolveConversationProduct,
  type ActiveView,
  type Conversation,
  type ProductArtifact
} from "../lib/asset-workspace-shared";
import dynamic from "next/dynamic";
import ConversationStart from "./conversation-start";
import ConversationStudio, { type ChatImageAttachment } from "./conversation-studio";
import AiBackgroundStatus, { type AiBackgroundTask } from "./ai-background-status";
import { UI_V3_BG_STATUS } from "../lib/ui-flags";
import type { LibraryActionIntent } from "./library-workshop";
import { LibraryWorkspaceErrorBoundary, LibraryWorkspaceLoading } from "./library-workspace-state";

// Split the heavy panels (react-markdown pipeline, library views) out of the
// initial bundle; only the active view's chunk is fetched. Auth gating already
// makes this subtree client-only, so ssr: false loses nothing.
const ProductWorkspace = dynamic(() => import("./product-workspace"), { ssr: false, loading: () => null });
const EmptyProductWorkspace = dynamic(
  () => import("./product-workspace").then((mod) => ({ default: mod.EmptyProductWorkspace })),
  { ssr: false, loading: () => null }
);
const AssetLibraryWorkshop = dynamic(() => import("./library-workshop"), { ssr: false, loading: () => <LibraryWorkspaceLoading title="资产库" /> });
const CopyLibraryWorkshop = dynamic(() => import("./library-workshop"), { ssr: false, loading: () => <LibraryWorkspaceLoading title="文案库" /> });
const ImageLibraryWorkshop = dynamic(() => import("./library-workshop"), { ssr: false, loading: () => <LibraryWorkspaceLoading title="图片库" /> });
const VideoLibraryWorkshop = dynamic(() => import("./library-workshop"), { ssr: false, loading: () => <LibraryWorkspaceLoading title="视频库" /> });

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
  initialView?: ActiveView;
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
  status: "pending" | "stopped" | "failed" | "unsubmitted";
  clientRequestId?: string;
};

type ChatImageUpload = ChatImageAttachment & {
  file: File;
};

export type VideoJobLiveStatus = {
  jobId: string;
  status: string;
  renderStage: string;
  steps: VideoJobStepResult[];
  errorMessage: string | null;
  completionConfirmed: boolean;
};

export function executionRunKey(jobId: string, generation: number): string {
  return jobId + "::" + generation;
}

export function nextExecutionRunGeneration(generation: number): number {
  return generation + 1;
}

export function resolveLiveExecutionTimelineSteps(
  live: Pick<VideoJobLiveStatus, "jobId" | "status" | "renderStage" | "steps">,
  mapBackendSteps: (steps: VideoJobStepResult[]) => AgentRunStep[] = agentTimelineStepsFromBackend,
  mapLegacySteps: (stage: string, status: string) => AgentRunStep[] = videoJobTimelineSteps,
): AgentRunStep[] {
  const backendSteps = mapBackendSteps(live.steps);
  if (backendSteps.length) return backendSteps;

  return mapLegacySteps(live.renderStage, live.status).map((step) => (
    step.status === "fail"
      ? { ...step, retryJobId: live.jobId }
      : step
  ));
}

export function executionVideoJobIds(
  conversations: Conversation[],
  selectedConversationId: string,
): string[] {
  const ids = new Set<string>();
  for (const conversation of conversations) {
    const selected = conversation.id === selectedConversationId;
    const products = conversation.products?.length ? conversation.products : [conversation.product];
    for (const product of products) {
      const metadata = product.metadata as Record<string, unknown> | undefined;
      const jobId = metadata?.latest_job_public_id;
      if (typeof jobId !== "string") continue;
      if (selected || metadata?.orchestration_pending === true) ids.add(jobId);
    }
  }
  return [...ids];
}

export function isExecutionTerminal(job: VideoJobResult): boolean {
  if (job.status === "failed") return true;
  if (job.status !== "completed") return false;
  return !job.steps.some(
    (step) => step.status === "run" || step.status === "wait",
  );
}

export function resolveExecutionTerminalObservation(
  wasObserved: boolean,
  isTerminal: boolean,
): { observed: boolean; shouldFinalize: boolean } {
  if (!isTerminal) return { observed: false, shouldFinalize: false };
  return { observed: true, shouldFinalize: wasObserved };
}

export function startExecutionJobPolls<T>({
  jobIds,
  inFlightJobIds,
  requestIdentity,
  isRequestCurrent,
  getJob,
  isCancelled,
  onJob,
  onFetchError,
}: {
  jobIds: Iterable<string>;
  inFlightJobIds: Set<string>;
  requestIdentity?: (jobId: string) => string;
  isRequestCurrent?: (jobId: string, identity: string) => boolean;
  getJob: (jobId: string) => Promise<T>;
  isCancelled: () => boolean;
  onJob: (job: T) => void;
  onFetchError: (jobId: string, error: unknown) => void;
}): void {
  for (const jobId of jobIds) {
    const identity = requestIdentity?.(jobId) ?? jobId;
    const current = () => isRequestCurrent?.(jobId, identity) ?? true;
    if (isCancelled() || !current() || inFlightJobIds.has(identity)) continue;
    inFlightJobIds.add(identity);
    void (async () => {
      try {
        let job: T;
        try {
          job = await getJob(jobId);
        } catch (error) {
          if (!isCancelled() && current()) onFetchError(jobId, error);
          return;
        }
        if (isCancelled() || !current()) return;
        onJob(job);
      } finally {
        inFlightJobIds.delete(identity);
      }
    })();
  }
}

export function startReadyConversationRefresh<T>({
  jobId,
  requestIdentity,
  isRequestCurrent,
  successfulJobIds,
  inFlightJobIds,
  isCancelled,
  refresh,
  onRefreshed,
  onRefreshError,
}: {
  jobId: string;
  requestIdentity?: string;
  isRequestCurrent?: (identity: string) => boolean;
  successfulJobIds: Set<string>;
  inFlightJobIds: Set<string>;
  isCancelled: () => boolean;
  refresh: () => Promise<T>;
  onRefreshed: (value: T) => void;
  onRefreshError: (error: unknown) => void;
}): boolean {
  const identity = requestIdentity ?? jobId;
  const current = () => isRequestCurrent?.(identity) ?? true;
  if (
    isCancelled()
    || !current()
    || successfulJobIds.has(identity)
    || inFlightJobIds.has(identity)
  ) {
    return false;
  }
  inFlightJobIds.add(identity);
  void (async () => {
    try {
      const value = await refresh();
      if (isCancelled() || !current()) return;
      onRefreshed(value);
      if (isCancelled() || !current()) return;
      successfulJobIds.add(identity);
    } catch (error) {
      if (isCancelled() || !current()) return;
      onRefreshError(error);
    } finally {
      inFlightJobIds.delete(identity);
    }
  })();
  return true;
}

export function applyExecutionJobResult({
  job,
  isCancelled,
  publishJob,
  startReadyRefresh,
  readyRefreshSucceeded,
  hasTerminalObservation,
  setTerminalObservation,
  finalizeJob,
}: {
  job: VideoJobResult;
  isCancelled: () => boolean;
  publishJob: (job: VideoJobResult) => void;
  startReadyRefresh: (jobId: string) => void;
  readyRefreshSucceeded: (jobId: string) => boolean;
  hasTerminalObservation: (jobId: string) => boolean;
  setTerminalObservation: (jobId: string, observed: boolean) => void;
  finalizeJob: (job: VideoJobResult) => void;
}): void {
  if (isCancelled()) return;
  publishJob(job);
  if (isCancelled()) return;

  const shouldRefreshConversation = job.status === "completed" || job.status === "failed";
  if (shouldRefreshConversation) {
    startReadyRefresh(job.id);
    if (isCancelled()) return;
  }

  const executionTerminal = isExecutionTerminal(job);
  const observation = job.status === "completed"
    ? resolveExecutionTerminalObservation(
        hasTerminalObservation(job.id),
        executionTerminal,
      )
    : {
        observed: false,
        shouldFinalize: executionTerminal,
      };
  if (isCancelled()) return;
  setTerminalObservation(job.id, observation.observed);
  if (isCancelled() || !observation.shouldFinalize) return;
  if (
    shouldRefreshConversation
    && !readyRefreshSucceeded(job.id)
  ) {
    return;
  }
  if (isCancelled()) return;
  finalizeJob(job);
}

export async function retryExecutionJob<T>({
  retryJobId,
  executionJobId,
  isCancelled,
  retryJob,
  getExecutionJob,
  reactivateExecution,
  storeExecution,
  restartPolling,
  onRetryRejected,
  onAggregateRefreshFailed,
  onSuccess,
}: {
  retryJobId: string;
  executionJobId: string;
  isCancelled: () => boolean;
  retryJob: (jobId: string) => Promise<unknown>;
  getExecutionJob: (jobId: string) => Promise<T>;
  reactivateExecution: (jobId: string) => void;
  storeExecution: (job: T) => void;
  restartPolling: () => void;
  onRetryRejected: (error: unknown) => void;
  onAggregateRefreshFailed: (notice: string, error: unknown) => void;
  onSuccess: () => void;
}): Promise<void> {
  try {
    await retryJob(retryJobId);
  } catch (error) {
    if (!isCancelled()) onRetryRejected(error);
    return;
  }
  if (isCancelled()) return;

  reactivateExecution(executionJobId);
  if (isCancelled()) return;

  let refreshed: T;
  try {
    refreshed = await getExecutionJob(executionJobId);
  } catch (error) {
    if (isCancelled()) return;
    onAggregateRefreshFailed(
      "重试已受理，状态刷新失败，正在继续轮询",
      error,
    );
    if (isCancelled()) return;
    restartPolling();
    return;
  }
  if (isCancelled()) return;

  storeExecution(refreshed);
  if (isCancelled()) return;
  restartPolling();
  if (isCancelled()) return;
  onSuccess();
}

export async function dispatchProductVideoJobRetry({
  product,
  retryExecution,
  onMissingJob,
}: {
  product: ProductArtifact;
  retryExecution: (retryJobId: string, executionJobId: string) => Promise<void>;
  onMissingJob: () => void;
}): Promise<boolean> {
  const metadata = product.metadata as Record<string, unknown> | undefined;
  const jobId = typeof metadata?.latest_job_public_id === "string"
    ? metadata.latest_job_public_id
    : null;
  if (!jobId) {
    onMissingJob();
    return false;
  }
  await retryExecution(jobId, jobId);
  return true;
}

// Background understanding tasks for the sidebar capsule (spec §5.1): assets
// uploaded via chat that are still being parsed/understood. Real state only —
// an empty list hides the capsule entirely.
function backgroundUnderstandingTasks(uploadsByConversation: Record<string, ChatImageUpload[]>): AiBackgroundTask[] {
  const tasks = new Map<string, AiBackgroundTask>();
  for (const uploads of Object.values(uploadsByConversation)) {
    for (const upload of uploads) {
      if (upload.status !== "processing") continue;
      const id = upload.assetId != null ? `asset-${upload.assetId}` : upload.id;
      if (tasks.has(id)) continue;
      tasks.set(id, {
        id,
        title: upload.title || upload.fileName,
        note: upload.fileKind === "image" ? "完成后可直接在对话中作为素材引用" : "完成后可直接在对话中引用"
      });
    }
  }
  return [...tasks.values()];
}

function getConversationMonogram(title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return "聊";

  const firstLatin = trimmedTitle.match(/[A-Za-z0-9]/)?.[0];
  if (firstLatin) return firstLatin.toUpperCase();

  return trimmedTitle[0];
}

function resolveInitialConversationId(initialConversationId: string | undefined, conversations: Conversation[]): string {
  if (initialConversationId === "new") return "new";
  return initialConversationId && conversations.some((conversation) => conversation.id === initialConversationId)
    ? initialConversationId
    : conversations[0]?.id ?? "new";
}

function resolveInitialView(initialView: ActiveView | undefined): ActiveView {
  return initialView && initialView !== "conversation" ? initialView : "conversation";
}

function uploadAcceptForView(view: ActiveView): string {
  if (view === "copy") return ".txt,.md,.markdown,.pdf,.docx,.html,.htm";
  if (view === "image") return ".png,.jpg,.jpeg,.webp,.gif";
  if (view === "video") return ".mp4,.mov,.webm,.mkv";
  return ".md,.markdown,.pdf,.xlsx,.xlsm,.docx,.pptx,.html,.htm,.txt";
}

function chatUploadFileKind(file: File): ChatImageUpload["fileKind"] {
  return file.type.startsWith("image/") ? "image" : "source";
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
  initialView,
  basePath = "/app/assets",
  accountEmail = "demo@multimix.local",
  token = null,
  onLogout
}: AssetsWorkspaceClientProps) {
  const [conversations, setConversations] = useState<Conversation[]>(() => assetWorkspaceAdapter.listConversations());
  const [activeView, setActiveView] = useState<ActiveView>(() => resolveInitialView(initialView));
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
  const [chatPanelWidth, setChatPanelWidth] = useState(640);
  // Demo-final default split (workspace-copy.html .app): product pane ≈448px,
  // chat takes the rest. Measured once on mount; dragging still re-clamps live.
  useEffect(() => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 700) return;
    setChatPanelWidth(Math.max(320, Math.round(rect.width - 448 - 10)));
  }, []);
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  // Inline rename: the conversation row swaps its title for a text input instead
  // of opening a browser prompt. Null when no row is being renamed.
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingConversationExchanges, setPendingConversationExchanges] = useState<Record<string, PendingConversationExchange>>({});
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [savedProductIds, setSavedProductIds] = useState<Record<string, string>>({});
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [conversationContextAssets, setConversationContextAssets] = useState<Record<string, ConversationContextAsset[]>>({});
  const [chatImageUploads, setChatImageUploads] = useState<Record<string, ChatImageUpload[]>>({});
  // Live per-asset video job status (stage + error) fed by the poller so the
  // workspace can show stage-level progress instead of a bare "生成中".
  const [videoJobLive, setVideoJobLive] = useState<Record<number, VideoJobLiveStatus>>({});
  const terminalVideoJobIdsRef = useRef(new Set<string>());
  const inFlightVideoJobIdsRef = useRef(new Set<string>());
  const readyConversationRefreshRef = useRef(new Set<string>());
  const readyConversationRefreshInFlightRef = useRef(new Set<string>());
  const executionRunGenerationRef = useRef(new Map<string, number>());
  const terminalObservationVideoJobIdsRef = useRef(new Set<string>());
  const activeExecutionVideoJobIdsRef = useRef(new Set<string>());
  const workspaceMountedRef = useRef(true);
  const [videoJobPollRevision, setVideoJobPollRevision] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsState>({
    open: false,
    loading: false,
    data: null,
    error: null
  });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Conversations render straight from state: delete removes the row and rename
  // updates its title in place, both persisted to the backend, so there is no
  // client-only overlay to reconcile on reload.
  const visibleConversationRows = conversations;
  const selectedConversation =
    visibleConversationRows.find((conversation) => conversation.id === selectedConversationId) ?? assetWorkspaceAdapter.getNewConversation();
  const selectedProduct = resolveConversationProduct(selectedConversation, selectedProductIds[selectedConversation.id]);
  const currentContextAssets = conversationContextAssets[selectedConversation.id] ?? [];
  const currentChatImageUploads = chatImageUploads[selectedConversation.id] ?? [];
  const backgroundTasks = useMemo(() => backgroundUnderstandingTasks(chatImageUploads), [chatImageUploads]);
  const isNewConversation = activeView === "conversation" && selectedConversation.id === "new";
  const canShowDiagnostics = process.env.NODE_ENV !== "production" || accountEmail === "local@admin" || accountEmail.endsWith("@multimix.local") || accountEmail.includes("+admin");
  const accountName = accountEmail.includes("@") ? accountEmail.slice(0, accountEmail.indexOf("@")) : accountEmail;

  useEffect(() => {
    workspaceMountedRef.current = true;
    return () => {
      workspaceMountedRef.current = false;
    };
  }, []);

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
    const nextView = resolveInitialView(initialView);
    if (nextView !== "conversation") {
      setActiveView(nextView);
      setConversationMenuId(null);
      return;
    }
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
  }, [initialConversationId, initialProductId, initialView]);

  // Load persisted conversation history from the backend when a token is present.
  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    let cancelled = false;
    void assetWorkspaceAdapter
      .loadConversations(token, assetWorkspaceAdapter.listConversations())
      .then((rows) => {
        if (cancelled) return;
        setConversations(rows);
        if (initialConversationId && rows.some((conversation) => conversation.id === initialConversationId)) {
          setSelectedConversationId(initialConversationId);
          setActiveView("conversation");
          if (initialProductId) {
            setSelectedProductIds((current) => ({
              ...current,
              [initialConversationId]: initialProductId,
            }));
          }
        }
      })
      .catch(() => {
        toast.error("无法加载对话历史，显示本地样例数据。");
      });
    return () => {
      cancelled = true;
    };
  }, [initialConversationId, initialProductId, token]);

  // Poll every pending background execution plus the selected conversation's
  // latest job. The selected job restores its persisted card once after refresh.
  const executionVideoJobKey = [
    ...new Set([
      ...executionVideoJobIds(conversations, selectedConversationId),
      ...activeExecutionVideoJobIdsRef.current,
    ]),
  ].sort().join(",");
  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    const jobIds = executionVideoJobKey ? executionVideoJobKey.split(",") : [];
    jobIds.forEach((jobId) => {
      if (!terminalVideoJobIdsRef.current.has(jobId)) {
        activeExecutionVideoJobIdsRef.current.add(jobId);
      }
    });
    const activeJobIds = new Set(activeExecutionVideoJobIdsRef.current);
    if (!activeJobIds.size) return;
    let cancelled = false;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };

    const startReadyRefresh = (jobId: string) => {
      if (cancelled) return;
      const requestIdentity = executionRunKey(
        jobId,
        executionRunGenerationRef.current.get(jobId) ?? 0,
      );
      startReadyConversationRefresh({
        jobId,
        requestIdentity,
        isRequestCurrent: (identity) => identity === executionRunKey(
          jobId,
          executionRunGenerationRef.current.get(jobId) ?? 0,
        ),
        successfulJobIds: readyConversationRefreshRef.current,
        inFlightJobIds: readyConversationRefreshInFlightRef.current,
        isCancelled: () => cancelled,
        refresh: () => assetWorkspaceAdapter.loadConversations(
          token,
          assetWorkspaceAdapter.listConversations(),
        ),
        onRefreshed: (rows) => {
          if (cancelled) return;
          setConversations(rows);
        },
        onRefreshError: () => {
          // Keep the job active; a later poll retries this refresh.
        },
      });
    };

    const publishJob = (job: VideoJobResult) => {
      if (cancelled) return;
      setVideoJobLive((current) => ({
        ...current,
        [job.assetId]: {
          jobId: job.id,
          status: job.status,
          renderStage: job.renderStage,
          steps: job.steps,
          errorMessage: job.errorMessage,
          completionConfirmed: false,
        },
      }));
    };

    const setTerminalObservation = (jobId: string, observed: boolean) => {
      if (cancelled) return;
      if (observed) terminalObservationVideoJobIdsRef.current.add(jobId);
      else terminalObservationVideoJobIdsRef.current.delete(jobId);
    };

    const finalizeJob = (job: VideoJobResult) => {
      if (cancelled) return;
      setVideoJobLive((current) => {
        const live = current[job.assetId];
        if (!live || live.jobId !== job.id || live.completionConfirmed) return current;
        return {
          ...current,
          [job.assetId]: {
            ...live,
            completionConfirmed: true,
          },
        };
      });
      terminalObservationVideoJobIdsRef.current.delete(job.id);
      terminalVideoJobIdsRef.current.add(job.id);
      activeExecutionVideoJobIdsRef.current.delete(job.id);
      activeJobIds.delete(job.id);
      if (cancelled) return;
      if (job.status === "failed") {
        const detail = job.errorMessage ? "：" + job.errorMessage : "，请重试或调整指令。";
        toast.error("视频生成失败" + detail);
      }
      if (!activeJobIds.size) stopPolling();
    };

    const processJob = (job: VideoJobResult) => {
      applyExecutionJobResult({
        job,
        isCancelled: () => cancelled,
        publishJob,
        startReadyRefresh,
        readyRefreshSucceeded: (jobId) => readyConversationRefreshRef.current.has(
          executionRunKey(
            jobId,
            executionRunGenerationRef.current.get(jobId) ?? 0,
          ),
        ),
        hasTerminalObservation: (jobId) => terminalObservationVideoJobIdsRef.current.has(jobId),
        setTerminalObservation,
        finalizeJob,
      });
    };

    const tick = () => {
      if (stopped || document.hidden) return;
      const pollJobIds = [...activeJobIds].filter(
        (jobId) => !terminalVideoJobIdsRef.current.has(jobId),
      );
      if (!pollJobIds.length) {
        stopPolling();
        return;
      }
      startExecutionJobPolls({
        jobIds: pollJobIds,
        inFlightJobIds: inFlightVideoJobIdsRef.current,
        requestIdentity: (jobId) => executionRunKey(
          jobId,
          executionRunGenerationRef.current.get(jobId) ?? 0,
        ),
        isRequestCurrent: (jobId, identity) => identity === executionRunKey(
          jobId,
          executionRunGenerationRef.current.get(jobId) ?? 0,
        ),
        getJob: (jobId) => assetWorkspaceAdapter.getVideoJob(token, jobId),
        isCancelled: () => cancelled,
        onJob: processJob,
        onFetchError: () => {
          // Transient per-job error; its own next interval retries it.
        },
      });
    };
    timer = setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [token, executionVideoJobKey, videoJobPollRevision]);

  // Keep the main job identity with its aggregate steps/error so an MG retry can
  // target its exact child job without replacing the original execution card.
  const liveRunStateByAssetId = useMemo(() => {
    const map: Record<number, {
      jobId: string;
      status: string;
      steps: AgentRunStep[];
      errorMessage: string | null;
      completionConfirmed: boolean;
    }> = {};
    for (const [assetId, live] of Object.entries(videoJobLive)) {
      map[Number(assetId)] = {
        jobId: live.jobId,
        status: live.status,
        steps: resolveLiveExecutionTimelineSteps(live),
        errorMessage: live.errorMessage,
        completionConfirmed: live.completionConfirmed,
      };
    }
    return map;
  }, [videoJobLive]);

  const handleRetryExecution = async (retryJobId: string, executionJobId: string) => {
    if (!token) {
      toast.error("登录状态已失效，请重新登录后重试。");
      return;
    }
    await retryExecutionJob({
      retryJobId,
      executionJobId,
      isCancelled: () => !workspaceMountedRef.current,
      retryJob: (jobId) => assetWorkspaceAdapter.retryVideoJob(token, jobId),
      getExecutionJob: (jobId) => assetWorkspaceAdapter.getVideoJob(token, jobId),
      reactivateExecution: (jobId) => {
        const previousGeneration = executionRunGenerationRef.current.get(jobId) ?? 0;
        readyConversationRefreshRef.current.delete(
          executionRunKey(jobId, previousGeneration),
        );
        executionRunGenerationRef.current.set(
          jobId,
          nextExecutionRunGeneration(previousGeneration),
        );
        terminalVideoJobIdsRef.current.delete(jobId);
        terminalObservationVideoJobIdsRef.current.delete(jobId);
        activeExecutionVideoJobIdsRef.current.add(jobId);
      },
      storeExecution: (refreshed) => {
        setVideoJobLive((current) => ({
          ...current,
          [refreshed.assetId]: {
            jobId: refreshed.id,
            status: refreshed.status,
            renderStage: refreshed.renderStage,
            steps: refreshed.steps,
            errorMessage: refreshed.errorMessage,
            completionConfirmed: false,
          },
        }));
      },
      restartPolling: () => setVideoJobPollRevision((current) => current + 1),
      onRetryRejected: (error) => {
        const message = error instanceof Error ? error.message : "请稍后再试。";
        toast.error("重试请求失败：" + message);
      },
      onAggregateRefreshFailed: (notice) => {
        setVideoJobLive((current) => {
          const entry = Object.entries(current).find(([, live]) => live.jobId === executionJobId);
          if (!entry) return current;
          const [assetId, live] = entry;
          return {
            ...current,
            [Number(assetId)]: {
              ...live,
              errorMessage: notice,
            },
          };
        });
        toast.error(notice);
      },
      onSuccess: () => toast.success("已重新开始失败步骤。"),
    });
  };

  const handleRetryVideoJob = async (product: ProductArtifact) => {
    await dispatchProductVideoJobRetry({
      product,
      retryExecution: handleRetryExecution,
      onMissingJob: () => toast.error("找不到可重试的任务。"),
    });
  };

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
    const handleWidth = 6;
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
    const handleWidth = 6;
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

  const handleStartRenameConversation = (conversation: Conversation) => {
    setConversationMenuId(null);
    if (conversation.id === "new") return;
    setRenameDraft(conversation.title);
    setRenamingConversationId(conversation.id);
  };

  const handleCancelRenameConversation = () => {
    setRenamingConversationId(null);
    setRenameDraft("");
  };

  const handleCommitRenameConversation = (conversation: Conversation) => {
    if (renamingConversationId !== conversation.id) return;
    const nextTitle = renameDraft.trim();
    setRenamingConversationId(null);
    setRenameDraft("");
    if (!nextTitle || nextTitle === conversation.title) return;
    const previousTitle = conversation.title;
    // Optimistically rename in place; reconcile against the backend below.
    setConversations((current) => current.map((item) =>
      item.id === conversation.id ? { ...item, title: nextTitle } : item
    ));
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    void assetWorkspaceAdapter.renameConversation(token, conversation.id, nextTitle).catch(() => {
      setConversations((current) => current.map((item) =>
        item.id === conversation.id ? { ...item, title: previousTitle } : item
      ));
      toast.error("重命名失败，请稍后重试。");
    });
  };

  const handleDeleteConversation = (conversationId: string) => {
    setConversationMenuId(null);
    if (conversationId === "new") return;
    const index = conversations.findIndex((conversation) => conversation.id === conversationId);
    if (index === -1) return;
    const removed = conversations[index];
    const nextConversation = conversations.find((conversation) => conversation.id !== conversationId);
    // Optimistically drop the row so the sidebar reacts instantly.
    setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
    if (selectedConversationId === conversationId) {
      setSelectedConversationId(nextConversation?.id ?? "new");
      setActiveView("conversation");
    }
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    void assetWorkspaceAdapter.deleteConversation(token, conversationId).catch(() => {
      // Restore on failure so we never hide a conversation that still exists.
      setConversations((current) => {
        if (current.some((conversation) => conversation.id === removed.id)) return current;
        const restored = [...current];
        restored.splice(Math.min(index, restored.length), 0, removed);
        return restored;
      });
      toast.error("删除失败，请稍后重试。");
    });
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
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", conversationId);
    url.searchParams.delete("product");
    window.history.replaceState(window.history.state, "", url);
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

  const handleChatImageUpload = (files: File[]) => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      toast.error("请先登录并配置后端后再上传资料。");
      return;
    }
    const targetConversationId = selectedConversation.readonly ? "new" : selectedConversation.id;
    const currentUploads = chatImageUploads[targetConversationId] ?? [];
    const imageCount = files.filter((file) => chatUploadFileKind(file) === "image").length;
    const currentImageCount = currentUploads.filter((upload) => upload.fileKind === "image").length;
    if (currentImageCount + imageCount > 20) {
      toast.error("上传图片不能超过 20 张。");
      return;
    }
    if (currentUploads.length + files.length > 24) {
      toast.error("本次上传资料不能超过 24 个。");
      return;
    }
    const uploads = files.map((file): ChatImageUpload => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      fileName: file.name,
      fileKind: chatUploadFileKind(file),
      title: file.name,
      status: "uploading",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
    }));
    setChatImageUploads((current) => ({
      ...current,
      [targetConversationId]: [...(current[targetConversationId] ?? []), ...uploads]
    }));
    setSelectedConversationId(targetConversationId);
    setActiveView("conversation");
    for (const upload of uploads) {
      void uploadChatImage(targetConversationId, upload);
    }
  };

  const uploadChatImage = async (conversationId: string, upload: ChatImageUpload) => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    try {
      const asset = await assetWorkspaceAdapter.uploadAsset(token, upload.file, upload.fileKind === "source" ? "assets" : "image");
      setChatImageUploads((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((item) =>
          item.id === upload.id
            ? {
              ...item,
              assetId: asset.id,
              title: asset.title || item.fileName,
              status: asset.status === "ready" ? "ready" : "processing",
              error: undefined
            }
            : item
        )
      }));
      setLibraryRefreshKey((value) => value + 1);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "资料上传失败。";
      setChatImageUploads((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((item) =>
          item.id === upload.id ? { ...item, status: "failed", error: msg } : item
        )
      }));
    }
  };

  const handleRemoveChatImage = (attachmentId: string) => {
    setChatImageUploads((current) => ({
      ...current,
      [selectedConversation.id]: (current[selectedConversation.id] ?? []).filter((item) => item.id !== attachmentId)
    }));
  };

  const handleRetryChatImage = (attachmentId: string) => {
    const upload = (chatImageUploads[selectedConversation.id] ?? []).find((item) => item.id === attachmentId);
    if (!upload) return;
    setChatImageUploads((current) => ({
      ...current,
      [selectedConversation.id]: (current[selectedConversation.id] ?? []).map((item) =>
        item.id === attachmentId ? { ...item, status: "uploading", error: undefined } : item
      )
    }));
    void uploadChatImage(selectedConversation.id, upload);
  };

  const materialPackageAsset = async (conversationId: string): Promise<ConversationContextAsset | null> => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return null;
    const readyUploads = (chatImageUploads[conversationId] ?? []).filter((item) => item.fileKind === "image" && item.status === "ready" && item.assetId);
    if (!readyUploads.length) return null;
    const titleSeed = readyUploads[0]?.title.replace(/\.[^.]+$/, "") || "本次上传图片";
    const asset = await assetWorkspaceAdapter.createMaterialPackage(token, {
      title: `${titleSeed}素材包`,
      assetIds: readyUploads.map((item) => item.assetId!),
      metadata: { source: "chat_composer_upload" }
    });
    return { id: asset.id, title: asset.title };
  };

  const sourceAttachmentAssets = (conversationId: string): ConversationContextAsset[] => (
    (chatImageUploads[conversationId] ?? [])
      .filter((upload) => upload.fileKind === "source" && upload.status === "ready" && upload.assetId)
      .map((upload) => ({ id: upload.assetId!, title: upload.title || upload.fileName }))
  );

  const handleSendConversationMessage = async (
    conversation: Conversation,
    instruction: string,
    signal?: AbortSignal,
    linkedAssets: ConversationContextAsset[] = [],
    clientRequestId?: string,
  ) => {
    if (conversation.readonly) {
      throw new Error("参考样例只读，不能继续对话。");
    }
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      throw new Error("请先登录并配置后端后再使用 AI 生成。");
    }
    const selectedBackendAssetId = selectedProduct?.backendAssetId;
    let assetsForSend = linkedAssets;
    if (assetsForSend.length === 0) {
      const sourceAssets = sourceAttachmentAssets(conversation.id);
      const packageAsset = await materialPackageAsset(conversation.id);
      assetsForSend = packageAsset ? [...sourceAssets, packageAsset] : sourceAssets;
    }
    const contextAssets = assetsForSend.length > 0 ? [] : conversationContextAssets[conversation.id] ?? [];
    const combinedContextAssets = mergeContextAssets(contextAssets, assetsForSend);
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
        clientRequestId,
        signal
      });
    } catch (error) {
      if (
        clientRequestId
        && !signal?.aborted
        && error instanceof Error
        && error.message === API_CONNECTION_ERROR
      ) {
        try {
          result = await assetWorkspaceAdapter.reconcileMessage({ token, clientRequestId });
        } catch {
          // The reconciliation request is also unreachable, so submission state
          // remains unknown and the original connection error stays visible.
        }
        if (result) {
          // Continue through the normal persisted-result replacement path.
        } else if (!signal?.aborted) {
          error = new Error(MESSAGE_NOT_SUBMITTED_ERROR);
        }
      }
      if (result) {
        // Reconciliation found the durable request; do not render a local error.
      } else {
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
    if (combinedLinkedAssetIds.length > 0) {
      setChatImageUploads((current) => {
        const next = { ...current };
        delete next[conversation.id];
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
    } catch (error) {
      setDiagnostics({ open: true, loading: false, data: null, error: formatComposerError(error) });
    }
  };

  const isSidebarVisuallyCollapsed = sidebarState === "auto" && isNarrowViewport;

  const shellClassName = [
    "shadcn-prototype-shell",
    sidebarState === "collapsed" ? "sidebar-collapsed" : "",
    sidebarState === "expanded" ? "sidebar-expanded" : "",
    isSidebarVisuallyCollapsed ? "sidebar-visual-collapsed" : ""
  ].filter(Boolean).join(" ");
  const insetClassName = activeView === "conversation" ? "shadcn-prototype-inset conversation-inset" : "shadcn-prototype-inset";
  const renderDiagnostics = () => canShowDiagnostics ? (
    <div className="shadcn-prototype-diagnostics">
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
                : diagnostics.error
                  ? "检测失败"
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
    </div>
  ) : null;

  const LibraryWorkshopForActiveView = activeView === "assets"
    ? AssetLibraryWorkshop
    : activeView === "copy"
      ? CopyLibraryWorkshop
      : activeView === "image"
        ? ImageLibraryWorkshop
        : VideoLibraryWorkshop;

  return (
    <main className={shellClassName}>
      <aside className="shadcn-prototype-sidebar" aria-label="Workspace navigation">
        <div className="shadcn-prototype-team">
          <span className="shadcn-prototype-brand-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 14 14" fill="none">
              <path d="M2 12V2.5L7 8l5-5.5V12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="shadcn-prototype-brand">
            <strong>MultiMix</strong>
          </div>
          <Link className="shadcn-prototype-home" href="/" aria-label="返回主页" title="返回主页">
            <House size={15} aria-hidden="true" />
          </Link>
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
          </div>

          <div className="shadcn-prototype-collapsed-rail-group">
            <button
              className={activeView === "assets" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="资产库"
              title="资产库"
              onClick={() => setActiveView("assets")}
            >
              <Package size={17} aria-hidden="true" />
            </button>
            <button
              className={activeView === "copy" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="文案库"
              title="文案库"
              onClick={() => setActiveView("copy")}
            >
              <FileText size={17} aria-hidden="true" />
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

        <button
          className={activeView === "conversation" && selectedConversation.id === "new" ? "shadcn-prototype-new-conversation active" : "shadcn-prototype-new-conversation"}
          type="button"
          onClick={() => {
            void handleStartConversation();
          }}
        >
          <Plus size={15} aria-hidden="true" />
          新建对话
        </button>

        <nav className="shadcn-prototype-nav" aria-label="Primary">
          <button className={activeView === "assets" ? "active" : ""} type="button" onClick={() => setActiveView("assets")}>
            <Package size={16} aria-hidden="true" />
            资产库
          </button>
          <button className={activeView === "copy" ? "active" : ""} type="button" onClick={() => setActiveView("copy")}>
            <FileText size={16} aria-hidden="true" />
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
                {renamingConversationId === conversation.id ? (
                  <div className="shadcn-prototype-conversation-main shadcn-prototype-conversation-rename">
                    <input
                      autoFocus
                      className="shadcn-prototype-conversation-rename-input"
                      aria-label="重命名对话"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.currentTarget.value)}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={() => handleCommitRenameConversation(conversation)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleCommitRenameConversation(conversation);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          handleCancelRenameConversation();
                        }
                      }}
                    />
                    <span>{conversation.updatedAt}</span>
                  </div>
                ) : (
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
                )}
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
                    <button type="button" onClick={() => handleStartRenameConversation(conversation)}>
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

        {UI_V3_BG_STATUS ? <AiBackgroundStatus tasks={backgroundTasks} /> : null}

        <div className="shadcn-prototype-user">
          <span className="shadcn-prototype-user-avatar" aria-hidden="true">{getConversationMonogram(accountEmail)}</span>
          <div>
            <strong>{accountName}</strong>
            <em title={accountEmail}>{accountEmail}</em>
          </div>
          {onLogout ? (
            <button type="button" className="shadcn-prototype-logout" aria-label="退出登录" title="退出登录" onClick={onLogout}>
              <LogOut size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </aside>

      <section className={insetClassName}>
        {activeView !== "conversation" ? (
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
              <strong>{assetWorkspaceAdapter.getWorkshop(activeView).title}</strong>
            </div>
            <div className="shadcn-prototype-actions">
              {renderDiagnostics()}
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
        ) : null}

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
              accountName={accountName}
              imageAttachments={currentChatImageUploads}
              onUploadImages={handleChatImageUpload}
              onRemoveImageAttachment={handleRemoveChatImage}
              onRetryImageAttachment={handleRetryChatImage}
              onSend={handleSendConversationMessage}
              token={token}
              onOpenImageLibrary={() => setActiveView("image")}
            />
          ) : activeView === "conversation" ? (
            <>
              <ConversationStudio
                basePath={basePath}
                contextAssets={currentContextAssets}
                selectedConversation={selectedConversation}
                selectedProduct={selectedProduct}
                onSelectProduct={handleSelectProduct}
                imageAttachments={currentChatImageUploads}
                onUploadImages={handleChatImageUpload}
                onRemoveImageAttachment={handleRemoveChatImage}
                onRetryImageAttachment={handleRetryChatImage}
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
                liveRunStateByAssetId={liveRunStateByAssetId}
                onRetryExecution={handleRetryExecution}
                diagnosticsSlot={renderDiagnostics()}
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
                  onRetryVideoJob={handleRetryVideoJob}
                  product={selectedProduct}
                  savedVersion={savedProductIds[selectedProduct.id]}
                  selectedConversation={selectedConversation}
                  token={token}
                  videoJobLive={selectedProduct.backendAssetId ? videoJobLive[selectedProduct.backendAssetId] ?? null : null}
                />
              ) : (
                <EmptyProductWorkspace />
              )}
            </>
          ) : (
            <LibraryWorkspaceErrorBoundary key={activeView}>
              <LibraryWorkshopForActiveView
                view={activeView}
                token={token}
                key={`${activeView}-${libraryRefreshKey}`}
                onUploadClick={handleUploadClick}
                uploading={uploading}
                onUseAsset={handleUseLibraryAsset}
                onAddAssetToConversation={handleAddAssetToConversation}
              />
            </LibraryWorkspaceErrorBoundary>
          )}
        </div>
      </section>
    </main>
  );
}
