"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  BookOpen,
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
  Search,
  Trash2,
  Video,
  X
} from "lucide-react";
import {
  API_BASE,
  API_CONNECTION_ERROR,
  addProjectSource,
  apiErrorStatus,
  formatComposerError,
  getAssetLlmDiagnostics,
  getCurrentUserPrivileges,
  getProjectResourceSummary,
  getProjectResources,
  MESSAGE_NOT_SUBMITTED_ERROR,
  removeProjectSource,
  type AssetLlmDiagnosticsRead,
} from "../../../lib/api";
import { agentTimelineStepsFromBackend } from "../../../lib/asset-mappers";
import { reconcileProductMutation, runExclusiveProductMutation, savedVersionForProduct, type ProductSaveFeedback } from "../lib/product-save-state";
import { trackProductEvent } from "../../../lib/product-analytics";
import { observeDirectorActivity, observeVideoActivity } from "../../../lib/product-activity";
import { getProjectBGMCatalog } from "../../../editor-engine/vendor/api";
import {
  assetWorkspaceAdapter,
  createLibraryCreationDraftConversation,
  isCurrentRequirementAnalysis,
  type LibraryRow,
  type ImageToVideoCostSummary,
  type NarrationUsageSummary,
  type SceneImageFitAdvice,
  type VideoJobResult,
  type VideoJobStepResult,
} from "../lib/asset-workspace-adapter";
import CreativeProfilePanel from "./creative-profile-panel";
import { createCreativeProject, getCreativeProfileCapabilities } from "../lib/creative-memory-api";
import type {
  AgentActionRunResponse,
  AgentRunStep,
  AssetCreativeDirectionSelection,
  AssetDirectorProductionPlan,
  AssetImageGenerationApplication,
  AssetImageGenerationSetApplication,
  AssetImageGenerationConfirmation,
  AssetImageGenerationRequest,
  AssetLongFormAction,
  AssetPlanBgmCatalog,
  AssetPresenterDirectionConfirmation,
  AssetPresenterDirectionRequest,
  AssetPresenterCleanupConfirmation,
  AssetPresenterAudioSelectionConfirmation,
  AssetProductSegment,
  AssetSourceResolutionSelection,
  AssetSubtitleOperation,
  AssetVideoSceneReplacement,
  AssetVideoParameterConfirmation,
  AssetVideoProjectConfirmation,
  AssetProjectResourceSummary,
  ProjectRequirementSnapshot,
} from "../lib/asset-workspace-types";
import {
  resolveConversationStageProducts,
  runExclusiveConversationDelete,
  chatAttachmentFileKind,
  pendingAttachmentReconciliationKeys,
  shouldImmediatelyReconcileAcceptedUpload,
  type ActiveView,
  type Conversation,
  type ProductArtifact
} from "../lib/asset-workspace-shared";
import dynamic from "next/dynamic";
import ConversationStart from "./conversation-start";
import useDialogFocusManagement from "../lib/use-dialog-focus-management";
import ConversationStudio, { type ChatImageAttachment } from "./conversation-studio";
import type {
  GeneratedImageGalleryApplication,
  GeneratedImageGallerySetApplication,
} from "./generated-image-gallery";
import AiBackgroundStatus, { type AiBackgroundTask } from "./ai-background-status";
import type { LibraryActionIntent } from "./library-workshop";
import type { SceneSourceAction } from "./product-preview";
import { sceneImageGenerationUtterance } from "../lib/scene-source-utterance";
import ProjectResourcesDrawer, {
  type ProjectResourceItem,
  type ProjectResourceKind,
  type ProjectResourceScope,
} from "./project-resources-drawer";
import ProjectTargetPicker from "./project-target-picker";
import { LibraryWorkspaceErrorBoundary, LibraryWorkspaceLoading } from "./library-workspace-state";
import {
  readConversationSummaryCache,
  writeConversationSummaryCache,
} from "../lib/conversation-summary-cache";
import {
  preserveSelectedConversationDetail,
  shouldLoadConversationDetail,
  shouldRestoreInitialConversationFocus,
} from "../lib/conversation-detail-load-policy";
import {
  agentActionPollLifecycleKey,
  agentActionPollOutcome,
  isPendingAgentAction,
  persistedAgentActions,
  type AgentActionLive,
} from "../lib/agent-action-poller";
import { useAssetGenerationJobs } from "../lib/use-asset-generation-jobs";
import { useStableCallback } from "../lib/use-stable-callback";
import {
  getLongFormCandidateContext,
  longFormAnalysisFromMetadata,
  type LongFormSourceAction,
} from "../lib/long-form-client";
import {
  prepareLongFormComposerSource,
} from "../lib/long-form-composer-source";
import {
  resolveChatVideoAttachmentPurpose,
  type ChatVideoAttachmentPurpose,
} from "../lib/chat-video-attachment-routing";
import {
  mergeConversationContextAssets,
  persistedConversationContextAssets,
  type ConversationContextAsset,
} from "../lib/conversation-context-assets";
import {
  isRuntimeConnectionError,
  resolveRuntimeWriteCapabilities,
  type RuntimeWriteConnectionState,
} from "../lib/runtime-write-capabilities";

// Split the heavy panels (react-markdown pipeline, library views) out of the
// initial bundle; only the active view's chunk is fetched. Auth gating already
// makes this subtree client-only, so ssr: false loses nothing.
const ProductWorkspace = dynamic(() => import("./product-workspace"), { ssr: false, loading: () => null });

const LibraryWorkshop = dynamic(() => import("./library-workshop"), { ssr: false, loading: () => <LibraryWorkspaceLoading title="素材库" /> });

type SidebarState = "auto" | "collapsed" | "expanded";
type ConversationLoadState = "unconfigured" | "loading" | "ready" | "error";
const PROJECT_STATE_LABELS: Record<NonNullable<Conversation["projectState"]>, string> = {
  needs_input: "待完善需求",
  script_review: "编导稿待确认",
  generating: "生成中",
  ready: "可继续编辑",
  needs_attention: "需要处理",
};

function projectStateLabel(state: Conversation["projectState"]): string {
  return state ? PROJECT_STATE_LABELS[state] : "待完善需求";
}

const PROJECT_LIST_STATE_LABELS: Partial<Record<NonNullable<Conversation["projectState"]>, string>> = {
  script_review: "待确认",
  generating: "生成中",
  needs_attention: "需处理",
};

export function projectListStateLabel(state: Conversation["projectState"]): string | null {
  return state ? PROJECT_LIST_STATE_LABELS[state] ?? null : null;
}

function mergeProjectConversationDetail(
  previous: Conversation | undefined,
  next: Conversation,
): Conversation {
  if (!previous) return next;
  return {
    ...next,
    projectState: next.projectState ?? previous.projectState,
    projectResourceSummary:
      next.projectResourceSummary ?? previous.projectResourceSummary,
  };
}
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

type PendingConversationExchange = {
  id: string;
  userText: string;
  assistantText: string;
  status: "pending" | "stopped" | "failed" | "unsubmitted";
  clientRequestId?: string;
};

type ChatImageUpload = ChatImageAttachment & {
  file?: File;
  sourceUrl?: string;
  idempotencyKey: string;
  videoPurpose?: ChatVideoAttachmentPurpose;
  sceneUploadTarget?: SceneUploadTarget;
};

type SceneUploadTarget = {
  conversationId: string;
  directorAssetId: number;
  directorVersionId: number;
  sceneId: string;
};

function sceneUploadUnderstandingFailure(category?: string | null): string {
  if (category === "provider_billing") {
    return "图片已保存，但视觉服务账户或计费不可用；恢复供应商服务后，在附件上点击“重试”重新解析。原分镜保持不变。";
  }
  if (category === "provider_timeout") {
    return "图片已保存，但视觉服务响应超时；可在附件上点击“重试”重新解析。原分镜保持不变。";
  }
  return "图片已保存，但视觉理解未完成；请在附件上点击“重试”重新解析，原分镜保持不变。";
}

const CHAT_UPLOAD_BATCH_CONCURRENCY = 3;
const DESKTOP_CHAT_PANEL_MIN = 480;
const DESKTOP_CHAT_PANEL_MAX = 720;
const DESKTOP_ARTIFACT_PANEL_MIN = 420;
const DESKTOP_CHAT_PANEL_RATIO = 0.52;
const NARROW_CHAT_PANEL_MIN = 320;
const NARROW_ARTIFACT_PANEL_MIN = 360;
const WORKSPACE_DIVIDER_WIDTH = 6;
const RECENT_PROJECT_LIMIT = 8;

function clampChatPanelWidth(workspaceWidth: number, desiredWidth: number, narrow: boolean): number {
  const minChatWidth = narrow ? NARROW_CHAT_PANEL_MIN : DESKTOP_CHAT_PANEL_MIN;
  const minArtifactWidth = narrow ? NARROW_ARTIFACT_PANEL_MIN : DESKTOP_ARTIFACT_PANEL_MIN;
  const preferredMax = narrow ? Number.POSITIVE_INFINITY : DESKTOP_CHAT_PANEL_MAX;
  const availableMax = Math.max(
    minChatWidth,
    workspaceWidth - minArtifactWidth - WORKSPACE_DIVIDER_WIDTH,
  );
  return Math.round(Math.min(preferredMax, availableMax, Math.max(minChatWidth, desiredWidth)));
}

function createUploadIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function agentActionLiveKey(conversationId: string, actionRunId: string): string {
  return `${conversationId}::${actionRunId}`;
}

export type VideoJobLiveStatus = {
  jobId: string;
  status: string;
  workflowStage: string;
  steps: VideoJobStepResult[];
  errorMessage: string | null;
  imageToVideoCostSummary?: ImageToVideoCostSummary | null;
  narrationUsageSummary?: NarrationUsageSummary | null;
  completionConfirmed: boolean;
  progressKind?: "video_create" | "video_update";
  connectionLost?: boolean;
  productStatus?: "generating" | "completed" | "failed";
  productCompleted?: boolean;
  failureReason?: string | null;
  failureAction?: "retry" | "retry_scene_generation" | "modify_script" | "replace_scene_asset" | null;
  failureSceneId?: string | null;
  operationStatus?: "generating" | "completed" | "failed" | null;
  operationFailureReason?: string | null;
  operationFailureAction?: "retry" | "retry_scene_generation" | "modify_script" | "replace_scene_asset" | null;
  operationFailureSceneId?: string | null;
};

export function videoJobLiveStatusFromResult(job: VideoJobResult): VideoJobLiveStatus {
  return {
    jobId: job.id,
    status: job.status,
    workflowStage: job.workflowStage,
    steps: job.steps,
    errorMessage: job.errorMessage,
    imageToVideoCostSummary: job.imageToVideoCostSummary,
    narrationUsageSummary: job.narrationUsageSummary,
    completionConfirmed: false,
    progressKind: job.operationStatus == null ? "video_create" : "video_update",
    connectionLost: false,
    productStatus: job.productStatus,
    productCompleted: job.productCompleted,
    failureReason: job.failureReason,
    failureAction: job.failureAction,
    failureSceneId: job.failureSceneId,
    operationStatus: job.operationStatus,
    operationFailureReason: job.operationFailureReason,
    operationFailureAction: job.operationFailureAction,
    operationFailureSceneId: job.operationFailureSceneId,
  };
}

export function markExecutionConnectionLost(
  current: Record<number, VideoJobLiveStatus>,
  jobId: string,
): Record<number, VideoJobLiveStatus> {
  const entry = Object.entries(current).find(([, live]) => live.jobId === jobId);
  if (!entry || entry[1].connectionLost) return current;
  const [assetId, live] = entry;
  return {
    ...current,
    [Number(assetId)]: { ...live, connectionLost: true },
  };
}

export function executionRunKey(jobId: string, generation: number): string {
  return jobId + "::" + generation;
}

export function nextExecutionRunGeneration(generation: number): number {
  return generation + 1;
}

export function resolveLiveExecutionTimelineSteps(
  live: Pick<VideoJobLiveStatus, "steps">,
  mapBackendSteps: (steps: VideoJobStepResult[]) => AgentRunStep[] = agentTimelineStepsFromBackend,
): AgentRunStep[] {
  const backendSteps = mapBackendSteps(live.steps);
  if (backendSteps.length) return backendSteps;
  return [{
    key: "status_unavailable",
    label: "正在获取执行状态",
    status: "run",
  }];
}

export function executionVideoJobIds(
  conversations: Conversation[],
  selectedConversationId: string,
): string[] {
  const ids = new Set<string>();
  for (const conversation of conversations) {
    const selected = conversation.id === selectedConversationId;
    if (selected) {
      for (const message of conversation.messages ?? []) {
        const metadata = message.metadata as Record<string, unknown> | undefined;
        const jobId = metadata?.job_public_id;
        const stage = metadata?.video_workflow_stage;
        if (
          typeof jobId === "string"
          && (message.presentation === "execution_anchor"
            || (typeof stage === "string" && stage.startsWith("video_project_")))
        ) {
          ids.add(jobId);
        }
      }
    }
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

function latestProductVersionId(product: ProductArtifact): number | null {
  const ids = (product.versions ?? [])
    .map((version) => Number(version.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? Math.max(...ids) : null;
}

export function executionConversationId(
  conversations: Conversation[],
  jobId: string,
  assetId: number,
): string | null {
  const productsFor = (conversation: Conversation) => (
    conversation.products?.length ? conversation.products : [conversation.product]
  );
  const jobMatches = conversations.filter((conversation) => (
    (conversation.messages ?? []).some((message) => message.metadata?.job_public_id === jobId)
    || productsFor(conversation).some((product) => product.metadata?.latest_job_public_id === jobId)
  ));
  if (jobMatches.length) return jobMatches.length === 1 ? jobMatches[0].id : null;
  const assetMatches = conversations.filter((conversation) => (
    productsFor(conversation).some((product) => product.backendAssetId === assetId)
  ));
  return assetMatches.length === 1 ? assetMatches[0].id : null;
}

export function isExecutionTerminal(job: VideoJobResult): boolean {
  if (job.productStatus === "generating") return false;
  if (job.productStatus === "failed" || job.productStatus === "completed") return true;
  if (job.status === "failed") return true;
  if (job.status !== "completed") return false;
  return !job.steps.some(
    (step) => step.status === "run" || step.status === "wait",
  );
}

export function resolveSelectedSceneFocus(
  product: ProductArtifact | null | undefined,
  selectedBackendAssetId: number | null | undefined,
  focus: { sceneId: string; versionId: number | null } | undefined,
): { sceneId: string; versionId: number } | undefined {
  if (!product || !focus || product.backendAssetId !== selectedBackendAssetId
    || !["video_project", "video_script"].includes(product.contentType ?? "")) return undefined;
  const plan = product.metadata?.video_plan;
  const planScenes = plan && typeof plan === "object" && !Array.isArray(plan)
    ? (plan as Record<string, unknown>).scenes : undefined;
  const hasScene = product.contentType === "video_script"
    ? Array.isArray(planScenes) && planScenes.some((scene) =>
      scene && typeof scene === "object" && (scene as Record<string, unknown>).id === focus.sceneId)
    : product.segments?.some((segment) => segment.id === focus.sceneId);
  if (focus.versionId === null || latestProductVersionId(product) !== focus.versionId || !hasScene) {
    throw new Error("分镜已更新或版本尚未就绪，请重新选择分镜后再修改。");
  }
  return { sceneId: focus.sceneId, versionId: focus.versionId };
}

export function shouldNotifyExecutionFailure(
  job: VideoJobResult,
  activeInThisPage: Set<string>,
): boolean {
  if (!isExecutionTerminal(job)) {
    activeInThisPage.add(job.id);
    return false;
  }
  return job.status === "failed" && activeInThisPage.has(job.id);
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
  startReadyRefresh: (jobId: string, phase: "project_ready" | "terminal") => void;
  readyRefreshSucceeded: (jobId: string, phase: "project_ready" | "terminal") => boolean;
  hasTerminalObservation: (jobId: string) => boolean;
  setTerminalObservation: (jobId: string, observed: boolean) => void;
  finalizeJob: (job: VideoJobResult) => void;
}): void {
  if (isCancelled()) return;
  publishJob(job);
  if (isCancelled()) return;

  const executionTerminal = isExecutionTerminal(job);
  const refreshPhase = executionTerminal ? "terminal" : "project_ready";
  const shouldRefreshConversation = job.status === "completed" || job.status === "failed";
  if (shouldRefreshConversation) {
    startReadyRefresh(job.id, refreshPhase);
    if (isCancelled()) return;
  }

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
    && !readyRefreshSucceeded(job.id, refreshPhase)
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
  retryJobId,
  retryExecution,
  onMissingJob,
}: {
  product: ProductArtifact;
  retryJobId?: string;
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
  await retryExecution(retryJobId || jobId, jobId);
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

export function newConversationUrl(currentUrl: URL): URL {
  const url = new URL(currentUrl.toString());
  url.searchParams.set("conversation", "new");
  url.searchParams.delete("product");
  return url;
}

function resolveInitialView(initialView: ActiveView | undefined): ActiveView {
  return initialView && initialView !== "conversation" ? initialView : "conversation";
}

function uploadAcceptForView(view: ActiveView): string {
  if (view === "copy") return ".txt,.md,.markdown,.pdf,.html,.htm";
  if (view === "image") return ".png,.jpg,.jpeg,.webp,.gif";
  if (view === "video") return ".mp4,.mov,.webm,.mkv";
  return ".md,.markdown,.pdf,.xlsx,.xlsm,.html,.htm,.txt";
}

function cachedConversationSummaries(accountEmail: string) {
  if (typeof window === "undefined") return [];
  try {
    return readConversationSummaryCache(window.localStorage, accountEmail);
  } catch {
    return [];
  }
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
  const router = useRouter();
  const backendConfigured = assetWorkspaceAdapter.isBackendEnabled();
  const initialConversationSummariesRef = useRef(cachedConversationSummaries(accountEmail));
  const [conversations, setConversations] = useState<Conversation[]>(() => (
    assetWorkspaceAdapter.mergeConversationSummaries(initialConversationSummariesRef.current, [])
  ));
  const [conversationLoadState, setConversationLoadState] = useState<ConversationLoadState>(() => (
    assetWorkspaceAdapter.isBackendEnabled()
      ? (initialConversationSummariesRef.current.length ? "ready" : "loading")
      : "unconfigured"
  ));
  const [conversationLoadRevision, setConversationLoadRevision] = useState(0);
  const [creativeProfileOpen, setCreativeProfileOpen] = useState(false);
  const [creativeProfileVisible, setCreativeProfileVisible] = useState(false);
  const [newConversationIgnoreProfile, setNewConversationIgnoreProfile] = useState(false);
  const closeCreativeProfile = useCallback(() => setCreativeProfileOpen(false), []);
  useEffect(() => {
    let active = true;
    setCreativeProfileVisible(false);
    setCreativeProfileOpen(false);
    if (token) {
      void getCreativeProfileCapabilities(token)
        .then((capabilities) => {
          if (active) setCreativeProfileVisible(capabilities.visible === true);
        })
        .catch(() => {
          if (active) setCreativeProfileVisible(false);
        });
    }
    return () => { active = false; };
  }, [token]);
  const [runtimeWriteConnectionState, setRuntimeWriteConnectionState] = useState<RuntimeWriteConnectionState>("checking");
  const runtimeWriteCapabilities = useMemo(() => resolveRuntimeWriteCapabilities({
    backendConfigured,
    hasToken: Boolean(token),
    connectionState: runtimeWriteConnectionState,
  }), [backendConfigured, runtimeWriteConnectionState, token]);
  // Applying an image that the backend has already generated is a persisted,
  // user-triggered selection. It must not be hidden behind the separate
  // generation-availability probe while the full conversation is hydrating.
  const canApplyExistingGeneratedImage = backendConfigured && Boolean(token);
  const handleLoadBgmCatalog = useCallback(async (assetId: number): Promise<AssetPlanBgmCatalog> => {
    const catalog = await getProjectBGMCatalog(String(assetId), token);
    return {
      catalogVersion: catalog.catalog_version,
      tracks: catalog.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        previewUrl: track.preview_url,
      })),
    };
  }, [token]);
  const deletingConversationIdsRef = useRef(new Set<string>());
  const [conversationDetailErrorId, setConversationDetailErrorId] = useState<string | null>(null);
  const [conversationDetailRetryRevision, setConversationDetailRetryRevision] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>(() => resolveInitialView(initialView));
  const productBeforeLeaveRef = useRef<(() => boolean | Promise<boolean>) | null>(null);
  const productCanLeaveSilentlyRef = useRef<(() => boolean) | null>(null);
  const selectedProductIdRef = useRef<string | null>(null);
  const navigationPendingRef = useRef(false);
  const registerProductBeforeLeave = useCallback((guard: () => boolean | Promise<boolean>, canLeaveSilently: () => boolean) => {
    productBeforeLeaveRef.current = guard;
    productCanLeaveSilentlyRef.current = canLeaveSilently;
    const editingProductId = !canLeaveSilently() ? selectedProductIdRef.current : null;
    if (editingProductId) {
      const conversationId = selectedConversationIdRef.current;
      setSelectedProductIds((current) => current[conversationId] === editingProductId
        ? current : { ...current, [conversationId]: editingProductId });
    }
    return () => {
      if (productBeforeLeaveRef.current === guard) {
        productBeforeLeaveRef.current = null;
        productCanLeaveSilentlyRef.current = null;
      }
    };
  }, []);
  const navigateWorkspace = (action: () => void, onDenied?: () => void) => {
    if (navigationPendingRef.current) { onDenied?.(); return; }
    const reopenNavigation = isNarrowViewport && narrowNavigationOpen;
    if (reopenNavigation) setNarrowNavigationOpen(false);
    const denied = () => {
      if (reopenNavigation) setNarrowNavigationOpen(true);
      onDenied?.();
    };
    const guard = productBeforeLeaveRef.current;
    const allowed = guard?.() ?? true;
    if (typeof allowed === "boolean") { if (allowed) action(); else denied(); return; }
    navigationPendingRef.current = true;
    void allowed.then((confirmed) => {
      if (!workspaceMountedRef.current || productBeforeLeaveRef.current !== guard) return;
      if (confirmed) action(); else denied();
    }).finally(() => { navigationPendingRef.current = false; });
  };
  const navigateView = (view: ActiveView) => navigateWorkspace(() => {
    setLibraryFocusedAssetId(null);
    setActiveView(view);
  });
  const [selectedConversationId, setSelectedConversationId] = useState(() => initialConversationId ?? "new");
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, string>>(() => {
    const conversationId = initialConversationId ?? "new";
    return initialProductId ? { [conversationId]: initialProductId } : {};
  });
  const [selectedImageFrameIds, setSelectedImageFrameIds] = useState<Record<string, string>>({});
  const [clickedSceneFocus, setClickedSceneFocus] = useState<Record<number, {
    sceneId: string;
    versionId: number | null;
  }>>({});
  const [sceneSourceProgress, setSceneSourceProgress] = useState<{
    sceneId: string; stage: string; error?: string;
  } | null>(null);
  const [sceneImagePicker, setSceneImagePicker] = useState<{
    conversationId: string;
    sceneId: string;
    directorAssetId: number;
    directorVersionId: number;
    options: Array<{ id: number; title: string; previewUrl?: string; origin: "上传" | "生成" }>;
    loading: boolean;
    error?: string;
    selectedOptionId?: number;
    fitLoading?: boolean;
    fit?: SceneImageFitAdvice;
    fitError?: string;
    fitBlocked?: boolean;
  } | null>(null);
  useEffect(() => setSceneImagePicker(null), [selectedConversationId]);
  const sceneSourceBusyRef = useRef(false);
  const sceneUploadInputRef = useRef<HTMLInputElement | null>(null);
  const sceneUploadTargetRef = useRef<SceneUploadTarget | null>(null);
  const selectedConversationIdRef = useRef(selectedConversationId);
  const pendingConversationNavigationRef = useRef<string | null>(null);
  const conversationsRef = useRef(conversations);
  const conversationDetailGenerationRef = useRef(0);
  const conversationDetailRequestKeyRef = useRef<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const isDividerDraggingRef = useRef(false);
  const [sidebarState, setSidebarState] = useState<SidebarState>("auto");
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [narrowNavigationOpen, setNarrowNavigationOpen] = useState(false);
  const navigationDialogRef = useRef<HTMLDivElement | null>(null);
  const navigationCloseRef = useRef<HTMLButtonElement | null>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeNarrowNavigation = () => {
    setNarrowNavigationOpen(false);
    window.requestAnimationFrame(() => navigationTriggerRef.current?.focus({ preventScroll: true }));
  };
  useDialogFocusManagement({
    open: isNarrowViewport && narrowNavigationOpen,
    dialogRef: navigationDialogRef,
    initialFocusRef: navigationCloseRef,
    onEscape: closeNarrowNavigation,
  });
  const [chatPanelWidth, setChatPanelWidth] = useState(640);
  // Desktop starts from the approved 52/48 balance and then respects the
  // shared chat/result bounds. Dragging continues to override this default.
  useEffect(() => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 700) return;
    setChatPanelWidth(clampChatPanelWidth(
      rect.width,
      rect.width * DESKTOP_CHAT_PANEL_RATIO,
      isNarrowViewport,
    ));
  }, [isNarrowViewport]);
  const [conversationMenuId, setConversationMenuId] = useState<string | null>(null);
  // Inline rename: the conversation row swaps its title for a text input instead
  // of opening a browser prompt. Null when no row is being renamed.
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingConversationExchanges, setPendingConversationExchanges] = useState<Record<string, PendingConversationExchange>>({});
  const onAssetGenerationConversationRefreshed = useStableCallback((detail: Conversation) => {
    setConversations((items) => items.map((item) => (
      item.id === detail.id ? mergeProjectConversationDetail(item, detail) : item
    )));
  });
  const onAssetGenerationConversationRefreshError = useStableCallback(() => {
    toast.error("内容已生成，但对话刷新失败，请重新打开这条对话。");
  });
  const {
    jobsForConversation: assetGenerationJobsForConversation,
    registerJob: registerAssetGenerationJob,
    retryJob: retryAssetGenerationJob,
    cancelJob: cancelAssetGenerationJob,
  } = useAssetGenerationJobs({
    token,
    conversations,
    onConversationRefreshed: onAssetGenerationConversationRefreshed,
    onConversationRefreshError: onAssetGenerationConversationRefreshError,
  });
  const [agentActions, setAgentActions] = useState<Record<string, AgentActionLive>>({});
  const agentActionsRef = useRef(agentActions);
  const inFlightAgentActionsRef = useRef(new Set<string>());
  const refreshedAgentActionsRef = useRef(new Set<string>());
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [savedProductIds, setSavedProductIds] = useState<Record<string, ProductSaveFeedback>>({});
  const [productMutationStates, setProductMutationStates] = useState<Record<string, "saving" | "restoring" | "refreshing" | undefined>>({});
  const [productSaveConflicts, setProductSaveConflicts] = useState<Record<string, { baseUpdatedAt?: string; message: string } | undefined>>({});
  const inFlightProductMutationsRef = useRef(new Set<string>());
  const productMutationScopeRef = useRef({ token, accountEmail });
  useEffect(() => {
    productMutationScopeRef.current = { token, accountEmail };
    setProductMutationStates({});
    setProductSaveConflicts({});
    setSavedProductIds({});
  }, [token, accountEmail]);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [conversationContextAssets, setConversationContextAssets] = useState<Record<string, ConversationContextAsset[]>>({});
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [showAllProjectRows, setShowAllProjectRows] = useState(false);
  const [projectResourcesOpen, setProjectResourcesOpen] = useState(false);
  const [projectResourceSummaries, setProjectResourceSummaries] = useState<Record<string, AssetProjectResourceSummary>>({});
  const [projectResourceSummaryRevision, setProjectResourceSummaryRevision] = useState(0);
  const invalidateProjectResourceSummary = (projectId: string) => {
    setProjectResourceSummaries((current) => {
      if (!(projectId in current)) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    if (selectedConversationIdRef.current === projectId) {
      setProjectResourceSummaryRevision((revision) => revision + 1);
    }
  };
  useEffect(() => {
    setProjectResourceSummaries({});
  }, [accountEmail, token]);
  useEffect(() => {
    if (!token || selectedConversationId === "new") return;
    const controller = new AbortController();
    const projectId = selectedConversationId;
    void getProjectResourceSummary(token, projectId, controller.signal)
      .then((summary) => {
        if (controller.signal.aborted) return;
        setProjectResourceSummaries((current) => ({
          ...current,
          [projectId]: {
            sources: summary.sources,
            historicalSources: summary.historical_sources,
            copies: summary.copies,
            covers: summary.covers,
            videos: summary.videos,
          },
        }));
      })
      .catch(() => {
        // A detail read can still provide the summary. Do not invent counts
        // or block conversation recovery when this independent read fails.
      });
    return () => controller.abort();
  }, [projectResourceSummaryRevision, selectedConversationId, token]);
  const [requirementRefreshErrorProjectId, setRequirementRefreshErrorProjectId] = useState<string | null>(null);
  const [requirementSnapshots, setRequirementSnapshots] = useState<Record<string, ProjectRequirementSnapshot>>({});
  const requirementReadGenerationRef = useRef(new Map<string, number>());
  const skipAutomaticRequirementReadRef = useRef(new Map<string, string>());
  const requirementEffectScopeRef = useRef<{ projectId: string; token: string | null; detailReady: boolean }>({
    projectId: "", token: null, detailReady: false,
  });
  const [inheritedRequirementNotices, setInheritedRequirementNotices] = useState<Record<string, boolean>>({});
  const [projectTargetRow, setProjectTargetRow] = useState<LibraryRow | null>(null);
  const [submittingProjectId, setSubmittingProjectId] = useState<string | null>(null);
  const [libraryTargetProjectId, setLibraryTargetProjectId] = useState<string | null>(null);
  const [libraryFocusedAssetId, setLibraryFocusedAssetId] = useState<number | null>(null);
  const closeLibraryFocusedAsset = useCallback(() => setLibraryFocusedAssetId(null), []);
  const [chatImageUploads, setChatImageUploads] = useState<Record<string, ChatImageUpload[]>>({});
  const chatImageUploadsRef = useRef<Record<string, ChatImageUpload[]>>({});
  const longFormSourceControllersRef = useRef(new Map<string, AbortController>());
  const inFlightSourceAttachmentReconciliationsRef = useRef(new Set<string>());
  const inFlightLongFormCandidateContextsRef = useRef(new Set<number>());
  // Live per-asset video job status (public workflow state + error) fed by the
  // poller so the workspace can show product progress instead of a bare "生成中".
  const [videoJobLive, setVideoJobLive] = useState<Record<number, VideoJobLiveStatus>>({});
  const terminalVideoJobIdsRef = useRef(new Set<string>());
  const inFlightVideoJobIdsRef = useRef(new Set<string>());
  const readyConversationRefreshRef = useRef(new Set<string>());
  const readyConversationRefreshInFlightRef = useRef(new Set<string>());
  const executionRunGenerationRef = useRef(new Map<string, number>());
  const terminalObservationVideoJobIdsRef = useRef(new Set<string>());
  const activeExecutionVideoJobIdsRef = useRef(new Set<string>());
  const failureNotifiableVideoJobIdsRef = useRef(new Set<string>());
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
  const [diagnosticsAccess, setDiagnosticsAccess] = useState<{ token: string; allowed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    setDiagnostics({ open: false, loading: false, data: null, error: null });
    if (backendConfigured && token) {
      void getCurrentUserPrivileges(token)
        .then((user) => {
          if (active) setDiagnosticsAccess({ token, allowed: user.is_admin === true || user.is_pilot === true });
        })
        .catch(() => {
          if (active) setDiagnosticsAccess({ token, allowed: false });
        });
    }
    return () => { active = false; };
  }, [backendConfigured, token]);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Conversations render straight from state: delete removes the row and rename
  // updates its title in place, both persisted to the backend, so there is no
  // client-only overlay to reconcile on reload.
  const visibleConversationRows = useMemo(() => {
    const normalizedQuery = projectSearchQuery.trim().toLocaleLowerCase();
    if (normalizedQuery) {
      return conversations.filter((conversation) => (
        conversation.title.toLocaleLowerCase().includes(normalizedQuery)
      ));
    }
    if (showAllProjectRows || conversations.length <= RECENT_PROJECT_LIMIT) return conversations;

    const recentRows = conversations.slice(0, RECENT_PROJECT_LIMIT);
    const selectedRow = conversations.find((conversation) => conversation.id === selectedConversationId);
    if (!selectedRow || recentRows.some((conversation) => conversation.id === selectedRow.id)) {
      return recentRows;
    }
    return [...recentRows.slice(0, RECENT_PROJECT_LIMIT - 1), selectedRow];
  }, [conversations, projectSearchQuery, selectedConversationId, showAllProjectRows]);
  const canToggleAllProjectRows = !projectSearchQuery.trim()
    && conversations.length > RECENT_PROJECT_LIMIT;
  const selectedPersistedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );
  const isConversationSnapshot = selectedPersistedConversation?.detailsLoaded === false;
  // Keep snapshot detail pending so the conversation pane shows its loading
  // skeleton. Its recovered product can still render read-only on the right.
  const selectedConversation = selectedPersistedConversation?.detailsLoaded === false
    ? {
        ...selectedPersistedConversation,
        // Snapshot and stale detail projections cannot prove the current
        // resource count. The independent selected-project read is authoritative.
        projectResources: undefined,
        projectResourceSummary: projectResourceSummaries[selectedPersistedConversation.id],
      }
    : selectedPersistedConversation ?? assetWorkspaceAdapter.getNewConversation();
  const selectedConversationHasDetail = selectedConversation.detailsLoaded === true;
  const { selectedProduct, displayProduct } = !selectedConversationHasDetail && !isConversationSnapshot
    ? { selectedProduct: null, displayProduct: null }
    : resolveConversationStageProducts(selectedConversation, selectedProductIds[selectedConversation.id]);
  const selectedProductRef = useRef(selectedProduct);
  selectedProductRef.current = selectedProduct;
  const observedVideoId = selectedProduct?.contentType === "video_project"
    ? selectedProduct.backendAssetId ?? null : null;
  const observeVideoInteractions = activeView === "conversation"
    && selectedProduct?.videoProjectReady === true
    && selectedProduct.operationStatus !== "generating"
    && !pendingConversationExchanges[selectedConversation.id]
    && !selectedConversation.readonly && !isConversationSnapshot;
  useEffect(() => observeVideoActivity(token, observedVideoId, observeVideoInteractions),
    [token, observedVideoId, observeVideoInteractions]);
  const observedDirectorId = selectedProduct?.contentType === "video_script"
    ? selectedProduct.backendAssetId ?? null : null;
  const observeDirectorInteractions = activeView === "conversation"
    && selectedConversationHasDetail && observedDirectorId !== null
    && selectedProduct?.operationStatus !== "generating"
    && !pendingConversationExchanges[selectedConversation.id]
    && !selectedConversation.readonly && !isConversationSnapshot;
  useEffect(() => observeDirectorActivity(token, observedDirectorId, observeDirectorInteractions),
    [token, observedDirectorId, observeDirectorInteractions]);
  selectedProductIdRef.current = selectedProduct?.id ?? null;
  const selectedAssetGenerationJobLives = assetGenerationJobsForConversation(selectedConversation.id);
  const selectedAssetGenerationJobs = selectedAssetGenerationJobLives.map((live) => live.job);
  const selectedAssetGenerationJobConnectionLostById = Object.fromEntries(
    selectedAssetGenerationJobLives.map((live) => [live.job.id, live.connectionLost === true]),
  );
  const currentContextAssets = conversationContextAssets[selectedConversation.id]
    ?? persistedConversationContextAssets(selectedConversation.messages ?? []);
  const projectResourceSummary = selectedConversation.projectResourceSummary ?? {
    sources: selectedConversation.projectResources?.sources.length ?? 0,
    historicalSources: 0,
    copies: selectedConversation.projectResources?.copies.length ?? 0,
    covers: selectedConversation.projectResources?.covers.length ?? 0,
    videos: selectedConversation.projectResources?.videos.length ?? 0,
  };
  const currentRequirementSnapshot = requirementSnapshots[selectedConversation.id] ?? null;
  const projectTargetOptions = conversations
    .filter((conversation) => conversation.id !== "new" && !conversation.readonly)
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      stateLabel: projectStateLabel(conversation.projectState),
      updatedAt: conversation.updatedAt,
    }));
  const libraryTargetProjectTitle = libraryTargetProjectId
    ? conversations.find((conversation) => conversation.id === libraryTargetProjectId)?.title ?? null
    : null;
  const currentChatImageUploads = chatImageUploads[selectedConversation.id] ?? [];
  const backgroundTasks = useMemo(() => backgroundUnderstandingTasks(chatImageUploads), [chatImageUploads]);
  const isNewConversation = activeView === "conversation" && selectedConversation.id === "new";
  const hasProductStage = activeView === "conversation" && displayProduct !== null;
  const canShowDiagnostics = Boolean(token && diagnosticsAccess?.token === token && diagnosticsAccess.allowed);

  const storeRequirementSnapshot = useCallback((conversationId: string, snapshot: ProjectRequirementSnapshot) => {
    setRequirementSnapshots((current) => ({ ...current, [conversationId]: snapshot }));
  }, []);

  const reloadCurrentRequirements = useCallback(async (conversationId: string, shouldApply: () => boolean = () => true) => {
    if (!token || conversationId === "new") return { snapshot: null, applied: false, synced: false };
    const readGeneration = requirementReadGenerationRef.current.get(conversationId) ?? 0;
    const isCurrentRead = () => shouldApply()
      && readGeneration === (requirementReadGenerationRef.current.get(conversationId) ?? 0);
    let snapshot: ProjectRequirementSnapshot | null;
    try {
      snapshot = await assetWorkspaceAdapter.loadCurrentRequirements(token, conversationId);
    } catch (error) {
      if (!isCurrentRead()) return { snapshot: null, applied: false, synced: false };
      throw error;
    }
    const applied = isCurrentRead();
    const synced = snapshot !== null && isCurrentRequirementAnalysis(snapshot);
    if (applied) {
      if (snapshot) storeRequirementSnapshot(conversationId, snapshot);
      else setRequirementSnapshots((current) => {
        if (!(conversationId in current)) return current;
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      setRequirementRefreshErrorProjectId((current) => (
        snapshot && !synced ? conversationId : current === conversationId ? null : current
      ));
    }
    return { snapshot, applied, synced };
  }, [storeRequirementSnapshot, token]);

  const retryProjectRequirements = async (projectId: string) => {
    if (!token || projectId === "new") return;
    const startedGeneration = requirementReadGenerationRef.current.get(projectId) ?? 0;
    const stillCurrent = () => selectedConversationIdRef.current === projectId
      && (requirementReadGenerationRef.current.get(projectId) ?? 0) === startedGeneration;
    try {
      const { snapshot, applied, synced } = await reloadCurrentRequirements(projectId, stillCurrent);
      if (!applied) return;
      if (synced) {
        toast.success("需求理解已同步。");
        return;
      }
      if (snapshot && snapshot.latestAnalysisStatus !== "failed") {
        toast.info("需求理解正在更新，请稍后查看最新结果。");
        return;
      }
      const latest = await assetWorkspaceAdapter.loadLatestRequirementVersion(token, projectId);
      if (!stillCurrent()) return;
      if (!latest || latest.status !== "failed") {
        if (!snapshot) toast.info("当前项目没有可同步的需求理解。");
        else toast.info("需求版本已变化，请刷新后重试。");
        return;
      }
      if (snapshot && snapshot.latestAnalysisVersion !== latest.version) {
        toast.info("需求版本已变化，请刷新后重试。");
        return;
      }
      await assetWorkspaceAdapter.retryRequirements(token, projectId, latest.id);
      if (!stillCurrent()) return;
      const refreshed = await reloadCurrentRequirements(projectId, stillCurrent);
      if (!refreshed.applied) return;
      if (refreshed.synced) toast.success("需求理解已同步。");
      else {
        setRequirementRefreshErrorProjectId(projectId);
        toast.info("需求分析仍未成功，已保留上一版内容；可稍后重试。");
      }
    } catch (error) {
      if (!stillCurrent()) return;
      try {
        const refreshed = await reloadCurrentRequirements(projectId, stillCurrent);
        if (!refreshed.applied) return;
        if (refreshed.synced) {
          toast.success("需求理解已同步。");
          return;
        }
      } catch {
        // Preserve the visible retry affordance when the authoritative read fails.
      }
      setRequirementRefreshErrorProjectId(projectId);
      toast.error(apiErrorStatus(error) === 409
        ? "需求或资料版本已变化，请刷新后重试。"
        : "需求理解仍未同步，请稍后重试。");
    }
  };

  useEffect(() => {
    const projectId = selectedConversation.id;
    const previousScope = requirementEffectScopeRef.current;
    const sameReadyScope = previousScope.projectId === projectId
      && previousScope.token === token
      && previousScope.detailReady;
    requirementEffectScopeRef.current = { projectId, token, detailReady: selectedConversation.detailsLoaded !== false };
    if (!token || projectId === "new" || selectedConversation.detailsLoaded === false) return;
    const skippedVersion = skipAutomaticRequirementReadRef.current.get(projectId);
    if (skippedVersion !== undefined) {
      skipAutomaticRequirementReadRef.current.delete(projectId);
      if (sameReadyScope && skippedVersion === selectedConversation.updatedAt) return;
    }
    let cancelled = false;
    void reloadCurrentRequirements(projectId, () => !cancelled)
      .catch(() => {
        // A project may legitimately predate requirement snapshots. Keep the
        // conversation usable and let explicit refresh surface later errors.
      });
    return () => { cancelled = true; };
  }, [reloadCurrentRequirements, selectedConversation.detailsLoaded, selectedConversation.id, selectedConversation.updatedAt, token]);
  const accountName = accountEmail.includes("@") ? accountEmail.slice(0, accountEmail.indexOf("@")) : accountEmail;
  const handleWriteAvailabilityChange = useStableCallback((state: RuntimeWriteConnectionState) => {
    setRuntimeWriteConnectionState(state);
  });
  const reportRuntimeWriteFailure = useStableCallback((error: unknown) => {
    if (isRuntimeConnectionError(error)) {
      setRuntimeWriteConnectionState("unavailable");
    }
  });
  const handleRetryWriteAvailability = useStableCallback(() => {
    setRuntimeWriteConnectionState("checking");
    setConversationLoadRevision((value) => value + 1);
  });

  useEffect(() => {
    const analysisAssetId = selectedProduct?.backendAssetId;
    const metadata = selectedProduct?.metadata ?? {};
    if (
      !token
      || selectedProduct?.contentType !== "long_form_candidate_set"
      || !analysisAssetId
      || (metadata.long_form_analysis && metadata.source_playback_url)
      || inFlightLongFormCandidateContextsRef.current.has(analysisAssetId)
    ) return;

    let cancelled = false;
    inFlightLongFormCandidateContextsRef.current.add(analysisAssetId);
    void getLongFormCandidateContext(token, analysisAssetId)
      .then((context) => {
        if (cancelled) return;
        setConversations((current) => current.map((conversation) => {
          const products = conversation.products?.length ? conversation.products : [conversation.product];
          if (!products.some((product) => product.backendAssetId === analysisAssetId)) return conversation;
          const hydratedProducts = products.map((product) => product.backendAssetId === analysisAssetId
            ? {
                ...product,
                metadata: {
                  ...(product.metadata ?? {}),
                  long_form_analysis: context.analysis,
                  source_playback_url: context.sourcePlaybackUrl,
                  chapter_count: context.analysis.chapters.length,
                },
              }
            : product);
          const primaryProduct = hydratedProducts.find((product) => product.id === conversation.product.id)
            ?? conversation.product;
          return { ...conversation, product: primaryProduct, products: hydratedProducts };
        }));
      })
      .catch((error) => {
        if (!cancelled) toast.error(formatComposerError(error));
      })
      .finally(() => {
        inFlightLongFormCandidateContextsRef.current.delete(analysisAssetId);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProduct?.backendAssetId, selectedProduct?.contentType, selectedProduct?.metadata, token]);

  useEffect(() => {
    workspaceMountedRef.current = true;
    const sourceControllers = longFormSourceControllersRef.current;
    return () => {
      workspaceMountedRef.current = false;
      for (const controller of sourceControllers.values()) {
        controller.abort();
      }
      sourceControllers.clear();
    };
  }, []);

  useEffect(() => {
    chatImageUploadsRef.current = chatImageUploads;
  }, [chatImageUploads]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    agentActionsRef.current = agentActions;
  }, [agentActions]);

  useEffect(() => {
    const persisted = persistedAgentActions(conversations);
    if (!persisted.length) return;
    setAgentActions((current) => {
      let changed = false;
      const next = { ...current };
      for (const entry of persisted) {
        const key = agentActionLiveKey(entry.conversationId, entry.action.id);
        const existing = next[key];
        if (existing && !isPendingAgentAction(existing.action)) continue;
        if (
          existing?.action.status === entry.action.status
          && existing.action.message === entry.action.message
          && existing.action.assetId === entry.action.assetId
          && existing.action.versionId === entry.action.versionId
        ) continue;
        next[key] = entry;
        changed = true;
      }
      if (changed) agentActionsRef.current = next;
      return changed ? next : current;
    });
  }, [conversations]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1180px)");
    const syncViewport = () => {
      setIsNarrowViewport(mediaQuery.matches);
      if (!mediaQuery.matches) setNarrowNavigationOpen(false);
    };

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
    const restoreCurrentRoute = () => {
      const url = new URL(window.location.href);
      url.searchParams.set("view", activeView);
      url.searchParams.set("conversation", selectedConversationIdRef.current);
      if (selectedProduct?.id) url.searchParams.set("product", selectedProduct.id);
      else url.searchParams.delete("product");
      router.replace(`${url.pathname}${url.search}${url.hash}`);
    };
    if (nextView !== "conversation") {
      if (nextView === activeView) return;
      navigateWorkspace(() => {
        setActiveView(nextView);
        setConversationMenuId(null);
      }, restoreCurrentRoute);
      return;
    }
    const routeConversationId = new URL(window.location.href).searchParams.get("conversation");
    if (routeConversationId !== initialConversationId) return;
    const pendingConversationId = pendingConversationNavigationRef.current;
    if (pendingConversationId && pendingConversationId !== initialConversationId) return;
    if (pendingConversationId === initialConversationId) {
      pendingConversationNavigationRef.current = null;
    }
    // A direct URL may arrive before the compact conversation list. Keep its
    // target long enough for the independent detail request below to hydrate
    // it; resolving against an empty list would otherwise replace it with new.
    const conversationId = initialConversationId && initialConversationId !== "new"
      ? initialConversationId
      : resolveInitialConversationId(initialConversationId, conversations);
    if (activeView === "conversation" && selectedConversationIdRef.current === conversationId
      && (!initialProductId || selectedProduct?.id === initialProductId)) return;
    navigateWorkspace(() => {
    selectedConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    if (initialProductId) {
      setSelectedProductIds((current) => ({
        ...current,
        [conversationId]: initialProductId
      }));
    }
    setActiveView("conversation");
    setConversationMenuId(null);
    }, restoreCurrentRoute);
    // conversations intentionally omitted: only re-run when the URL params change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, initialProductId, initialView]);

  // Load persisted conversation history from the backend when a token is present.
  useEffect(() => {
    if (!backendConfigured) {
      setRuntimeWriteConnectionState("checking");
      setConversationLoadState("unconfigured");
      setConversations([]);
      return;
    }
    if (!token) {
      setRuntimeWriteConnectionState("checking");
      setConversationLoadState("loading");
      return;
    }
    let cancelled = false;
    if (!conversationsRef.current.length) setConversationLoadState("loading");
    void assetWorkspaceAdapter.loadConversationSummaries(token)
      .then((summaries) => {
        if (cancelled) return;
        try {
          writeConversationSummaryCache(window.localStorage, accountEmail, summaries);
        } catch {
          // Storage can be unavailable in private browsing; network data still wins.
        }
        setConversations((current) => {
          const merged = assetWorkspaceAdapter.mergeConversationSummaries(summaries, current);
          // A direct link can target an older conversation outside the compact
          // recent-summary page. Keep its fully loaded detail when that page
          // arrives after the detail request, rather than replacing it with an
          // unrelated first summary row.
          return preserveSelectedConversationDetail({
            merged,
            current,
            selectedConversationId: selectedConversationIdRef.current,
          });
        });
        setRuntimeWriteConnectionState("available");
        setConversationLoadState("ready");
        const currentRoute = new URL(window.location.href);
        const currentRouteConversationId = currentRoute.searchParams.get("conversation");
        if (initialConversationId && !navigationPendingRef.current
          && productCanLeaveSilentlyRef.current?.() !== false
          && currentRoute.searchParams.get("product") === (initialProductId ?? null)
          && shouldRestoreInitialConversationFocus({
          activeView,
          pendingConversationId: pendingConversationNavigationRef.current,
          routeConversationId: currentRouteConversationId,
          initialConversationId,
          selectedConversationId: selectedConversationIdRef.current,
          summaryIds: summaries.map((conversation) => conversation.id),
        })) {
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
        if (cancelled) return;
        setRuntimeWriteConnectionState("unavailable");
        if (conversationsRef.current.length) {
          setConversationLoadState("ready");
          toast.error("无法刷新项目列表，正在显示上次记录。");
        } else {
          setConversations([]);
          setConversationLoadState("error");
          toast.error("无法加载项目，请重新加载。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountEmail, activeView, backendConfigured, initialConversationId, initialProductId, token, conversationLoadRevision]);

  useEffect(() => {
    const selectedDetailLoaded = selectedPersistedConversation?.detailsLoaded === true;
    if (!shouldLoadConversationDetail({
      hasToken: Boolean(token),
      conversationId: selectedConversationId,
      detailsLoaded: selectedDetailLoaded,
    }) || !token) return;
    const requestKey = `${selectedConversationId}:${conversationDetailRetryRevision}`;
    if (conversationDetailRequestKeyRef.current === requestKey) return;
    conversationDetailRequestKeyRef.current = requestKey;
    const generation = conversationDetailGenerationRef.current + 1;
    conversationDetailGenerationRef.current = generation;
    setConversationDetailErrorId(null);
    void assetWorkspaceAdapter
      .loadConversationSnapshot(token, selectedConversationId)
      .then((snapshot) => {
        if (conversationDetailGenerationRef.current !== generation) return;
        setConversations((current) => {
          const existing = current.find((conversation) => conversation.id === snapshot.id);
          if (existing?.detailsLoaded === true) return current;
          if (existing) {
            return current.map((conversation) => (
              conversation.id === snapshot.id
                ? mergeProjectConversationDetail(conversation, snapshot)
                : conversation
            ));
          }
          return [snapshot, ...current];
        });
      })
      .catch(() => {
        // The full detail request remains authoritative.  A failed snapshot
        // must not turn a recoverable historical conversation into an error.
      });
    void assetWorkspaceAdapter
      .loadConversationDetail(token, selectedConversationId)
      .then((detail) => {
        if (conversationDetailGenerationRef.current !== generation) return;
        setConversations((current) => {
          if (current.some((conversation) => conversation.id === detail.id)) {
            return current.map((conversation) => (
              conversation.id === detail.id
                ? mergeProjectConversationDetail(conversation, detail)
                : conversation
            ));
          }
          return [detail, ...current];
        });
      })
      .catch(() => {
        if (conversationDetailGenerationRef.current === generation) {
          setConversationDetailErrorId(selectedConversationId);
          toast.error("无法加载这个项目的完整内容，请重试。");
        }
      });
  }, [conversationDetailRetryRevision, selectedConversationId, selectedPersistedConversation, token]);

  const agentActionPollKey = agentActionPollLifecycleKey(
    Object.values(agentActions),
  );
  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled() || !agentActionPollKey) return;
    const authToken = token;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    function publish(live: AgentActionLive, action: AgentActionRunResponse) {
      const key = agentActionLiveKey(live.conversationId, action.id);
      const nextLive = { conversationId: live.conversationId, action };
      agentActionsRef.current = {
        ...agentActionsRef.current,
        [key]: nextLive,
      };
      setAgentActions((current) => ({
        ...current,
        [key]: nextLive,
      }));
    }

    function schedule(live: AgentActionLive, delay: number) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void poll(live);
      }, delay);
      timers.add(timer);
    }

    async function poll(live: AgentActionLive) {
      const key = agentActionLiveKey(live.conversationId, live.action.id);
      const current = agentActionsRef.current[key];
      if (
        cancelled
        || current?.action.id !== live.action.id
        || inFlightAgentActionsRef.current.has(key)
      ) return;
      inFlightAgentActionsRef.current.add(key);
      try {
        const remote = await assetWorkspaceAdapter.getAgentAction(
          authToken,
          live.conversationId,
          live.action.id,
        );
        if (cancelled) return;
        const outcome = agentActionPollOutcome(remote);
        if (!outcome.terminal) {
          publish(live, remote);
          if (isPendingAgentAction(remote)) {
            schedule({ conversationId: live.conversationId, action: remote }, 4000);
          }
          return;
        }

        if (
          outcome.refreshConversation
          && !refreshedAgentActionsRef.current.has(key)
        ) {
          try {
            const detail = await assetWorkspaceAdapter.loadConversationDetail(
              authToken,
              live.conversationId,
            );
            if (cancelled) return;
            const editingProductId = selectedConversationIdRef.current === live.conversationId
              && productCanLeaveSilentlyRef.current?.() === false ? selectedProductIdRef.current : null;
            setConversations((items) => items.map((item) => (
              item.id === detail.id
                ? mergeProjectConversationDetail(item, detail)
                : item
            )));
            setSelectedProductIds((currentIds) => {
              if (editingProductId) return { ...currentIds, [live.conversationId]: editingProductId };
              if (
                currentIds[live.conversationId]
                || !outcome.assetId
                || !(detail.products ?? []).some(
                  (product) => product.backendAssetId === outcome.assetId,
                )
              ) return currentIds;
              return {
                ...currentIds,
                [live.conversationId]: `asset-${outcome.assetId}`,
              };
            });
            refreshedAgentActionsRef.current.add(key);
          } catch {
            if (!cancelled) {
              schedule({ conversationId: live.conversationId, action: remote }, 4000);
            }
            return;
          }
        }

        publish(live, remote);
        if (remote.status === "failed" || remote.status === "blocked") {
          toast.error(remote.message || "视频修改失败，请检查后重试。");
        }
      } catch {
        if (!cancelled) schedule(live, 4000);
      } finally {
        inFlightAgentActionsRef.current.delete(key);
      }
    }

    for (const live of Object.values(agentActionsRef.current)) {
      if (isPendingAgentAction(live.action)) schedule(live, 200);
    }
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [agentActionPollKey, token]);

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

    const startReadyRefresh = (jobId: string, phase: "project_ready" | "terminal", assetId: number) => {
      if (cancelled) return;
      const conversationId = executionConversationId(conversationsRef.current, jobId, assetId);
      if (!conversationId) {
        setVideoJobLive((current) => markExecutionConnectionLost(current, jobId));
        return;
      }
      const runIdentity = executionRunKey(
        jobId,
        executionRunGenerationRef.current.get(jobId) ?? 0,
      );
      // The project becomes editable before non-blocking MG children finish.
      // Refresh once for that milestone and again when all children are
      // terminal so the editor receives the patched overlay track.
      const requestIdentity = `${runIdentity}::${phase}`;
      startReadyConversationRefresh({
        jobId,
        requestIdentity,
        isRequestCurrent: (identity) => identity.startsWith(`${executionRunKey(
          jobId,
          executionRunGenerationRef.current.get(jobId) ?? 0,
        )}::`),
        successfulJobIds: readyConversationRefreshRef.current,
        inFlightJobIds: readyConversationRefreshInFlightRef.current,
        isCancelled: () => cancelled,
        refresh: () => assetWorkspaceAdapter.loadConversationDetail(token, conversationId),
        onRefreshed: (row) => {
          if (cancelled) return;
          setConversations((current) => current.map((item) => item.id === row.id ? row : item));
        },
        onRefreshError: () => {
          setVideoJobLive((current) => markExecutionConnectionLost(current, jobId));
        },
      });
    };

    const publishJob = (job: VideoJobResult) => {
      if (cancelled) return;
      setVideoJobLive((current) => ({
        ...current,
        [job.assetId]: videoJobLiveStatusFromResult(job),
      }));
    };

    const setTerminalObservation = (jobId: string, observed: boolean) => {
      if (cancelled) return;
      if (observed) terminalObservationVideoJobIdsRef.current.add(jobId);
      else terminalObservationVideoJobIdsRef.current.delete(jobId);
    };

    const finalizeJob = (job: VideoJobResult) => {
      if (cancelled) return;
      const notifyFailure = shouldNotifyExecutionFailure(
        job,
        failureNotifiableVideoJobIdsRef.current,
      );
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
      failureNotifiableVideoJobIdsRef.current.delete(job.id);
      activeJobIds.delete(job.id);
      if (cancelled) return;
      if (notifyFailure) {
        const detail = job.errorMessage ? "：" + job.errorMessage : "，请重试或调整指令。";
        toast.error("视频生成失败" + detail);
      }
      if (!activeJobIds.size) stopPolling();
    };

    const processJob = (job: VideoJobResult) => {
      shouldNotifyExecutionFailure(job, failureNotifiableVideoJobIdsRef.current);
      applyExecutionJobResult({
        job,
        isCancelled: () => cancelled,
        publishJob,
        startReadyRefresh: (jobId, phase) => startReadyRefresh(jobId, phase, job.assetId),
        readyRefreshSucceeded: (jobId, phase) => readyConversationRefreshRef.current.has(
          `${executionRunKey(
            jobId,
            executionRunGenerationRef.current.get(jobId) ?? 0,
          )}::${phase}`,
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
        onFetchError: (jobId) => {
          setVideoJobLive((current) => markExecutionConnectionLost(current, jobId));
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
      imageToVideoCostSummary?: ImageToVideoCostSummary | null;
      narrationUsageSummary?: NarrationUsageSummary | null;
      completionConfirmed: boolean;
      progressKind: "video_create" | "video_update";
      connectionLost: boolean;
      productStatus?: "generating" | "completed" | "failed";
      failureAction?: "retry" | "retry_scene_generation" | "modify_script" | "replace_scene_asset" | null;
      operationStatus?: "generating" | "completed" | "failed" | null;
      operationFailureAction?: "retry" | "retry_scene_generation" | "modify_script" | "replace_scene_asset" | null;
    }> = {};
    for (const [assetId, live] of Object.entries(videoJobLive)) {
      map[Number(assetId)] = {
        jobId: live.jobId,
        status: live.status,
        steps: resolveLiveExecutionTimelineSteps(live),
        errorMessage: (live.progressKind === "video_update" || live.operationStatus != null)
          ? live.operationFailureReason ?? live.failureReason ?? null
          : live.failureReason ?? live.operationFailureReason ?? null,
        imageToVideoCostSummary: live.imageToVideoCostSummary,
        narrationUsageSummary: live.narrationUsageSummary,
        completionConfirmed: live.completionConfirmed,
        progressKind: live.progressKind ?? (live.operationStatus == null ? "video_create" : "video_update"),
        connectionLost: live.connectionLost === true,
        productStatus: live.productStatus,
        failureAction: live.failureAction,
        operationStatus: live.operationStatus,
        operationFailureAction: live.operationFailureAction,
      };
    }
    return map;
  }, [videoJobLive]);

  const liveAgentActionsById = useMemo(() => {
    const map: Record<string, AgentActionRunResponse> = {};
    for (const live of Object.values(agentActions)) {
      if (live.conversationId === selectedConversation.id) {
        map[live.action.id] = live.action;
      }
    }
    return map;
  }, [agentActions, selectedConversation.id]);

  const handleRetryGeneration = async (jobId: string) => {
    if (!runtimeWriteCapabilities.canGenerate) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能重新生成。");
      return;
    }
    if (!token) return;
    try {
      await retryAssetGenerationJob(jobId, selectedConversation.id);
    } catch (error) {
      reportRuntimeWriteFailure(error);
      toast.error(formatComposerError(error));
    }
  };

  const handleCancelGeneration = async (jobId: string) => {
    if (!token) return;
    try {
      await cancelAssetGenerationJob(jobId);
    } catch (error) {
      reportRuntimeWriteFailure(error);
      toast.error(formatComposerError(error));
    }
  };

  const handleRetryAgentAction = async (actionRunId: string) => {
    if (!runtimeWriteCapabilities.canGenerate) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能重试修改任务。");
      return;
    }
    if (!token) {
      toast.error("登录状态已失效，请重新登录后重试。");
      return;
    }
    const live = Object.values(agentActionsRef.current).find(
      (item) => item.conversationId === selectedConversation.id
        && item.action.id === actionRunId,
    );
    if (!live?.action.retryable) {
      toast.error("这个修改任务不能安全重试。");
      return;
    }
    const key = agentActionLiveKey(live.conversationId, actionRunId);
    try {
      const action = await assetWorkspaceAdapter.retryAgentAction(
        token,
        live.conversationId,
        actionRunId,
      );
      const nextLive = { conversationId: live.conversationId, action };
      refreshedAgentActionsRef.current.delete(key);
      agentActionsRef.current = {
        ...agentActionsRef.current,
        [key]: nextLive,
      };
      setAgentActions((current) => ({
        ...current,
        [key]: nextLive,
      }));
      toast.success("已重新开始这个修改步骤。");
    } catch (error) {
      reportRuntimeWriteFailure(error);
      toast.error(formatComposerError(error));
    }
  };

  const handleRetryExecution = async (retryJobId: string, executionJobId: string) => {
    if (!runtimeWriteCapabilities.canGenerate) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能重试生成任务。");
      return;
    }
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
        failureNotifiableVideoJobIdsRef.current.add(jobId);
      },
      storeExecution: (refreshed) => {
        setVideoJobLive((current) => ({
          ...current,
          [refreshed.assetId]: videoJobLiveStatusFromResult(refreshed),
        }));
      },
      restartPolling: () => setVideoJobPollRevision((current) => current + 1),
      onRetryRejected: (error) => {
        reportRuntimeWriteFailure(error);
        const message = error instanceof Error ? error.message : "请稍后再试。";
        toast.error("重试请求失败：" + message);
      },
      onAggregateRefreshFailed: (notice, error) => {
        reportRuntimeWriteFailure(error);
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

  const handleRetryVideoJob = async (product: ProductArtifact, retryJobId?: string) => {
    if (!runtimeWriteCapabilities.canGenerate) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能重试视频任务。");
      return;
    }
    await dispatchProductVideoJobRetry({
      product,
      retryJobId,
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
    const minChatWidth = isNarrowViewport ? NARROW_CHAT_PANEL_MIN : DESKTOP_CHAT_PANEL_MIN;
    const maxChatWidth = clampChatPanelWidth(
      workspaceRect.width,
      Number.POSITIVE_INFINITY,
      isNarrowViewport,
    );
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
    const minChatWidth = isNarrowViewport ? NARROW_CHAT_PANEL_MIN : DESKTOP_CHAT_PANEL_MIN;
    const maxChatWidth = workspaceRect
      ? clampChatPanelWidth(workspaceRect.width, Number.POSITIVE_INFINITY, isNarrowViewport)
      : isNarrowViewport ? 640 : DESKTOP_CHAT_PANEL_MAX;
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
    if (conversation.id === "new" || !runtimeWriteCapabilities.canPersist) return;
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
    if (!nextTitle || nextTitle === conversation.title || !runtimeWriteCapabilities.canPersist) return;
    const previousTitle = conversation.title;
    // Optimistically rename in place; reconcile against the backend below.
    setConversations((current) => current.map((item) =>
      item.id === conversation.id ? { ...item, title: nextTitle } : item
    ));
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    void assetWorkspaceAdapter.renameConversation(token, conversation.id, nextTitle)
      .then(() => setConversationLoadRevision((value) => value + 1))
      .catch((error) => {
        reportRuntimeWriteFailure(error);
        setConversations((current) => current.map((item) =>
          item.id === conversation.id ? { ...item, title: previousTitle } : item
        ));
        toast.error("重命名失败，请稍后重试。");
      });
  };

  const handleDeleteConversation = (conversationId: string) => {
    if (!runtimeWriteCapabilities.canPersist) return;
    void runExclusiveConversationDelete(
      deletingConversationIdsRef.current,
      conversationId,
      async () => {
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
        try {
          await assetWorkspaceAdapter.deleteConversation(token, conversationId);
          setConversationLoadRevision((value) => value + 1);
        } catch (error) {
          reportRuntimeWriteFailure(error);
          // Restore on failure so we never hide a conversation that still exists.
          setConversations((current) => {
            if (current.some((conversation) => conversation.id === removed.id)) return current;
            const restored = [...current];
            restored.splice(Math.min(index, restored.length), 0, removed);
            return restored;
          });
          toast.error("删除失败，请稍后重试。");
        }
      },
    );
  };

  const handleCollapseSidebar = () => {
    if (isNarrowViewport) closeNarrowNavigation();
    else setSidebarState("collapsed");
  };

  const handleExpandSidebar = () => {
    if (isNarrowViewport) setNarrowNavigationOpen(true);
    else setSidebarState("expanded");
  };

  const handleOpenCreativeProfile = () => {
    setNarrowNavigationOpen(false);
    setCreativeProfileOpen(true);
  };

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === selectedConversation.id && activeView === "conversation") {
      setNarrowNavigationOpen(false);
      return;
    }
    navigateWorkspace(() => {
    pendingConversationNavigationRef.current = conversationId;
    selectedConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    setActiveView("conversation");
    setConversationMenuId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", conversationId);
    url.searchParams.delete("product");
    router.replace(`${url.pathname}${url.search}${url.hash}`);
    });
  };

  const handleSelectProduct = (conversationId: string, productId: string) => {
    if (conversationId === selectedConversation.id && productId === selectedProduct?.id) return;
    navigateWorkspace(() => {
    setSelectedProductIds((current) => ({
      ...current,
      [conversationId]: productId
    }));
    });
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

  const runProductMutation = async (
    product: ProductArtifact,
    kind: "saving" | "restoring" | "refreshing",
    operation: (requestToken: string, conversationId: string) => Promise<{ product: ProductArtifact; message: string }>,
  ) => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      toast.error("请先登录并连接后端。");
      return;
    }
    if (kind !== "refreshing" && !runtimeWriteCapabilities.canPersist) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能保存。");
      return;
    }
    const conversationId = selectedConversation.id;
    const requestToken = token;
    const requestScope = productMutationScopeRef.current;
    const isCurrentScope = () => workspaceMountedRef.current && productMutationScopeRef.current === requestScope;
    const mutationKey = `${accountEmail}:${product.id}`;
    await runExclusiveProductMutation(inFlightProductMutationsRef.current, mutationKey, async () => {
      setProductMutationStates((current) => ({ ...current, [product.id]: kind }));
      try {
        const result = await operation(requestToken, conversationId);
        if (!isCurrentScope()) return;
        const current = conversationsRef.current;
        if (reconcileProductMutation(current, conversationId, product, result.product) === current) {
          toast.info("产物已更新，已忽略过期响应，请核对当前版本。");
          return;
        }
        setConversations((items) => isCurrentScope()
          ? reconcileProductMutation(items, conversationId, product, result.product) : items);
        if (kind !== "refreshing") {
          setSavedProductIds((items) => ({ ...items,
            [product.id]: { version: result.product.version ?? "", updatedAt: result.product.backendUpdatedAt },
          }));
        }
        setProductSaveConflicts((items) => ({ ...items, [product.id]: undefined }));
        toast.success(result.message);
      } catch (error) {
        if (!isCurrentScope()) return;
        reportRuntimeWriteFailure(error);
        const message = kind === "refreshing"
          ? "读取最新版本失败，原产物与输入已保留，请重试。"
          : apiErrorStatus(error) === 409
            ? "产物已有新的修改，本次操作未覆盖它。请读取最新版本后核对。"
            : error instanceof Error ? error.message : "操作失败，请稍后重试。";
        if (kind === "refreshing" || apiErrorStatus(error) === 409) {
          setProductSaveConflicts((items) => ({ ...items,
            [product.id]: { baseUpdatedAt: product.backendUpdatedAt, message },
          }));
        }
        toast.error(message);
      } finally {
        if (isCurrentScope()) setProductMutationStates((items) => ({ ...items, [product.id]: undefined }));
      }
    });
  };

  const handleSaveProduct = (product: ProductArtifact) => runProductMutation(product, "saving", async (requestToken) => {
    const result = await assetWorkspaceAdapter.saveProduct(product, requestToken);
    return { product: result.product, message: "已保存" };
  });

  const handleReloadProduct = (product: ProductArtifact) => runProductMutation(product, "refreshing", async (requestToken, conversationId) => {
    const refreshed = await assetWorkspaceAdapter.loadConversationDetail(requestToken, conversationId);
    const latest = (refreshed.products ?? [refreshed.product]).find((item) =>
      item.id === product.id && item.backendAssetId === product.backendAssetId);
    if (!latest) throw new Error("当前项目中未找到该产物。");
    return { product: latest, message: "已读取最新版本，请核对后再决定是否修改。" };
  });

  const handleRestoreProductVersion = (product: ProductArtifact, versionId: string) =>
    runProductMutation(product, "restoring", async (requestToken) => {
      const result = await assetWorkspaceAdapter.restoreProductVersion({ token: requestToken, product, versionId });
      return { product: result.product, message: result.assistantMessage || "已基于历史版本生成新版本" };
    });

  const handleStartConversation = () => {
    navigateWorkspace(() => {
    setNewConversationIgnoreProfile(false);
    pendingConversationNavigationRef.current = "new";
    selectedConversationIdRef.current = "new";
    setActiveView("conversation");
    setConversationMenuId(null);
    setSelectedConversationId("new");
    const url = newConversationUrl(new URL(window.location.href));
    router.replace(`${url.pathname}${url.search}${url.hash}`);
    });
  };

  const handleCloneProjectFromRequirements = async (conversation: Conversation) => {
    if (!token || !runtimeWriteCapabilities.canPersist) return;
    const snapshot = requirementSnapshots[conversation.id];
    if (!snapshot) {
      toast.error("当前项目还没有可继承的需求快照。");
      return;
    }
    try {
      const clone = await assetWorkspaceAdapter.cloneProjectFromRequirements(
        token,
        conversation.id,
        snapshot.version,
      );
      setConversations((current) => [clone, ...current.filter((item) => item.id !== clone.id)]);
      if (clone.requirementSnapshot) {
        storeRequirementSnapshot(clone.id, clone.requirementSnapshot);
      }
      void trackProductEvent(token, {
        eventName: "requirement_clone_created",
        conversationId: conversation.id,
        properties: { snapshot_version: snapshot.version },
      });
      setInheritedRequirementNotices((current) => ({ ...current, [clone.id]: true }));
      setConversationMenuId(null);
      handleSelectConversation(clone.id);
      toast.success("已基于当前需求新建独立项目。");
    } catch (error) {
      if (apiErrorStatus(error) === 409) {
        await reloadCurrentRequirements(conversation.id).catch(() => null);
        toast.info("需求已经更新，请确认最新版本后再新建项目。");
        return;
      }
      toast.error(formatComposerError(error));
    }
  };

  const refreshProjectConversation = async (projectId: string, skipAutomaticRequirementRead = false) => {
    if (!token) return;
    if (selectedConversationIdRef.current === projectId) {
      // A detail request started before the source write must not restore its
      // old resource summary after this refresh completes.
      conversationDetailGenerationRef.current += 1;
      conversationDetailRequestKeyRef.current = `${projectId}:${conversationDetailRetryRevision}`;
    }
    const refreshed = await assetWorkspaceAdapter.loadConversationDetail(token, projectId);
    if (skipAutomaticRequirementRead) {
      skipAutomaticRequirementReadRef.current.set(projectId, refreshed.updatedAt);
    }
    setConversations((current) => current.map((conversation) => (
      conversation.id === projectId
        ? mergeProjectConversationDetail(conversation, refreshed)
        : conversation
    )));
    if (selectedConversationIdRef.current === projectId) setConversationDetailErrorId(null);
  };

  const invalidateProjectRequirements = (projectId: string) => {
    requirementReadGenerationRef.current.set(projectId, (requirementReadGenerationRef.current.get(projectId) ?? 0) + 1);
    setRequirementSnapshots((current) => {
      if (!(projectId in current)) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
  };

  const markProjectDetailRefreshFailed = (projectId: string) => {
    const isSelectedProject = selectedConversationIdRef.current === projectId;
    if (isSelectedProject || conversationDetailRequestKeyRef.current?.startsWith(`${projectId}:`)) {
      conversationDetailGenerationRef.current += 1;
      conversationDetailRequestKeyRef.current = isSelectedProject
        ? `${projectId}:${conversationDetailRetryRevision}`
        : null;
    }
    setConversations((current) => current.map((conversation) => (
      conversation.id === projectId ? { ...conversation, detailsLoaded: false } : conversation
    )));
    invalidateProjectRequirements(projectId);
    if (isSelectedProject) {
      setConversationDetailErrorId(projectId);
      setProjectResourcesOpen(false);
    }
  };

  const handleLibraryAssetArchived = async (assetId: number) => {
    setConversationContextAssets((current) => {
      const next = { ...current };
      for (const conversation of conversationsRef.current) {
        next[conversation.id] = (
          current[conversation.id] ?? persistedConversationContextAssets(conversation.messages ?? [])
        ).filter((asset) => asset.id !== assetId);
      }
      for (const [projectId, assets] of Object.entries(current)) {
        next[projectId] = assets.filter((asset) => asset.id !== assetId);
      }
      return next;
    });
    const selectedProjectId = selectedConversationIdRef.current;
    if (selectedProjectId !== "new") invalidateProjectResourceSummary(selectedProjectId);
    // An earlier project-detail response must not restore pre-archive resources.
    const generation = conversationDetailGenerationRef.current + 1;
    conversationDetailGenerationRef.current = generation;
    conversationDetailRequestKeyRef.current = selectedProjectId === "new"
      ? null
      : `${selectedProjectId}:${conversationDetailRetryRevision}`;
    setConversationDetailErrorId(null);
    setConversations((current) => current.map((conversation) => ({
      ...conversation,
      detailsLoaded: false,
    })));
    setConversationLoadRevision((value) => value + 1);
    if (selectedProjectId === "new" || !token) return;
    try {
      const refreshed = await assetWorkspaceAdapter.loadConversationDetail(token, selectedProjectId);
      if (conversationDetailGenerationRef.current !== generation) return;
      setConversations((current) => current.map((conversation) => (
        conversation.id === selectedProjectId
          ? mergeProjectConversationDetail(conversation, refreshed)
          : conversation
      )));
    } catch (error) {
      if (conversationDetailGenerationRef.current !== generation) return;
      setConversationDetailErrorId(selectedProjectId);
      throw error;
    }
  };

  const persistLibraryAssetToProject = async (row: LibraryRow, projectId: string) => {
    if (!token || !row.assetId) return;
    setSubmittingProjectId(projectId);
    try {
      await addProjectSource(token, projectId, row.assetId);
    } catch (error) {
      reportRuntimeWriteFailure(error);
      toast.error(error instanceof Error ? error.message : "加入项目失败，请重试。");
      setSubmittingProjectId(null);
      return;
    }
    invalidateProjectResourceSummary(projectId);
    invalidateProjectRequirements(projectId);
    if (projectId === selectedConversation.id) {
      setConversationContextAssets((current) => ({
        ...current,
        [projectId]: mergeConversationContextAssets(
          current[projectId] ?? [],
          [{ id: row.assetId!, title: row.title }],
        ),
      }));
    }
    setProjectTargetRow(null);
    try {
      await refreshProjectConversation(projectId, true);
    } catch {
      markProjectDetailRefreshFailed(projectId);
      toast.info("已加入项目并保存，但资料暂未同步。进入该项目后可重试加载。");
      setSubmittingProjectId(null);
      return;
    }
    try {
      const { snapshot, applied, synced } = await reloadCurrentRequirements(projectId);
      if (!applied) {
        toast.info("已加入项目并保存，需求理解将在最新变更后同步。");
      } else if (snapshot && synced) {
        toast.success("已加入项目，并立即保存。");
      } else {
        setRequirementRefreshErrorProjectId(projectId);
        toast.info(snapshot
          ? "已加入项目并保存，但新资料尚未计入需求理解；当前显示上一版内容。"
          : "已加入项目并保存，但需求理解暂未同步。");
      }
    } catch {
      invalidateProjectRequirements(projectId);
      setRequirementRefreshErrorProjectId(projectId);
      toast.info("已加入项目并保存，但需求理解暂未同步。");
    }
    setSubmittingProjectId(null);
  };

  const handleAddAssetToConversation = (row: LibraryRow) => {
    if (!runtimeWriteCapabilities.canGenerate) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能发起创作。");
      return;
    }
    if (!row.assetId) {
      toast.error("这个条目还没有后端资产 ID。");
      return;
    }
    if (!token) {
      toast.error("当前未连接项目服务。");
      return;
    }
    if (libraryTargetProjectId) {
      void persistLibraryAssetToProject(row, libraryTargetProjectId);
      return;
    }
    setProjectTargetRow(row);
  };

  const handleUseLibraryAsset = async (row: LibraryRow, intent: LibraryActionIntent) => {
    if (!runtimeWriteCapabilities.canGenerate) {
      toast.error(runtimeWriteCapabilities.reason ?? "当前暂不能发起创作。");
      return;
    }
    if (!row.assetId) {
      toast.error("这个条目还没有后端资产 ID。");
      return;
    }
    const linkedAsset = { id: row.assetId, title: row.title };
    const newConversation = assetWorkspaceAdapter.getNewConversation();
    const targetConversation = createLibraryCreationDraftConversation(newConversation);
    const instruction = intent === "video"
      ? `基于《${row.title}》做成视频。`
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

  const hydrateConversationForImageApplication = async (): Promise<Conversation> => {
    const current = conversationsRef.current.find(
      (conversation) => conversation.id === selectedConversation.id,
    ) ?? selectedConversation;
    if (current.detailsLoaded === true) return current;
    if (!token || current.id === "new") {
      throw new Error("当前完整对话尚未就绪，暂不能应用图片。");
    }
    const detail = await assetWorkspaceAdapter.loadConversationDetail(token, current.id);
    setConversations((items) => items.map((conversation) => (
      conversation.id === detail.id
        ? mergeProjectConversationDetail(conversation, detail)
        : conversation
    )));
    return detail;
  };

  const handleApplyGeneratedImage = async (application: GeneratedImageGalleryApplication) => {
    if (!canApplyExistingGeneratedImage) {
      throw new Error("当前完整对话尚未就绪，暂不能应用图片。");
    }
    const conversation = await hydrateConversationForImageApplication();
    await handleSendConversationMessage(
      conversation,
      application.target.kind === "cover" ? "将这张图片设为封面" : "将这张图片应用到分镜",
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        candidateAssetId: application.candidateAssetId,
        expectedCandidateSetHash: application.candidateSetHash,
        clientRequestId: globalThis.crypto.randomUUID(),
        target: application.target,
      },
    );
  };

  const handleApplyGeneratedImageSet = async (application: GeneratedImageGallerySetApplication) => {
    if (!canApplyExistingGeneratedImage) {
      throw new Error("当前完整对话尚未就绪，暂不能应用关键帧组。");
    }
    const conversation = await hydrateConversationForImageApplication();
    await handleSendConversationMessage(
      conversation,
      `将 ${application.assignments.length} 张图片分别应用到分镜`,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        expectedCandidateSetHash: application.candidateSetHash,
        clientRequestId: globalThis.crypto.randomUUID(),
        target: application.target,
        assignments: application.assignments,
      },
    );
  };

  const handleChatImageUpload = (files: File[], sceneUploadTarget?: SceneUploadTarget) => {
    if (!runtimeWriteCapabilities.canUpload || !token || !assetWorkspaceAdapter.isBackendEnabled()) {
      toast.error("请先登录并配置后端后再上传资料。");
      return;
    }
    const targetConversation = selectedConversation.readonly
      ? assetWorkspaceAdapter.getNewConversation()
      : selectedConversation;
    const targetConversationId = targetConversation.id;
    if (sceneUploadTarget && (
      sceneUploadTarget.conversationId !== targetConversationId
      || files.length !== 1 || chatAttachmentFileKind(files[0]) !== "image"
    )) {
      toast.error("分镜上传目标已变化，请重新选择这一镜和图片。");
      return;
    }
    const videoPurpose = resolveChatVideoAttachmentPurpose(targetConversation);
    const currentUploads = chatImageUploads[targetConversationId] ?? [];
    const imageCount = files.filter((file) => chatAttachmentFileKind(file) === "image").length;
    const currentImageCount = currentUploads.filter((upload) => upload.fileKind === "image").length;
    const videoCount = files.filter((file) => chatAttachmentFileKind(file) === "video").length;
    const currentVideoCount = currentUploads.filter((upload) => upload.fileKind === "video").length;
    if (currentImageCount + imageCount > 20) {
      toast.error("上传图片不能超过 20 张。");
      return;
    }
    if (currentVideoCount + videoCount > 1) {
      toast.error(
        "每次请只添加一个视频。",
      );
      return;
    }
    if (currentUploads.length + files.length > 24) {
      toast.error("本次上传资料不能超过 24 个。");
      return;
    }
    const uploads = files.map((file): ChatImageUpload => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      idempotencyKey: createUploadIdempotencyKey(),
      file,
      fileName: file.name,
      fileKind: chatAttachmentFileKind(file),
      videoPurpose: chatAttachmentFileKind(file) === "video" ? videoPurpose : undefined,
      sceneUploadTarget,
      title: file.name,
      status: "uploading",
      uploadProgress: 0,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
    }));
    setChatImageUploads((current) => ({
      ...current,
      [targetConversationId]: [...(current[targetConversationId] ?? []), ...uploads]
    }));
    setSelectedConversationId(targetConversationId);
    setActiveView("conversation");
    void (async () => {
      for (let start = 0; start < uploads.length; start += CHAT_UPLOAD_BATCH_CONCURRENCY) {
        await Promise.all(
          uploads
            .slice(start, start + CHAT_UPLOAD_BATCH_CONCURRENCY)
            .map((upload) => uploadChatImage(targetConversationId, upload)),
        );
      }
    })();
  };

  const persistReadyVisualMaterial = useCallback(async (
    conversationId: string,
    assetId: number,
    title: string,
  ) => {
    if (!token || conversationId === "new") return;
    await addProjectSource(token, conversationId, assetId);
    setConversationContextAssets((current) => ({
      ...current,
      [conversationId]: mergeConversationContextAssets(
        current[conversationId] ?? [],
        [{ id: assetId, title }],
      ),
    }));
    const refreshed = await assetWorkspaceAdapter.loadConversationDetail(
      token,
      conversationId,
    );
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? mergeProjectConversationDetail(conversation, refreshed)
        : conversation
    )));
    return refreshed;
  }, [token]);

  const offerReadySceneUpload = useCallback((
    upload: ChatImageUpload, assetId: number, refreshed: Conversation | undefined,
  ) => {
    const target = upload.sceneUploadTarget;
    if (!target || selectedConversationIdRef.current !== target.conversationId) return;
    const current = selectedProductRef.current;
    const authoritativeDirector = refreshed?.products?.find(
      (product) => product.backendAssetId === target.directorAssetId,
    );
    if (current?.backendAssetId !== target.directorAssetId
      || latestProductVersionId(current) !== target.directorVersionId
      || !authoritativeDirector
      || latestProductVersionId(authoritativeDirector) !== target.directorVersionId) {
      setSceneSourceProgress({ sceneId: target.sceneId, stage: "分镜已更新",
        error: "图片已保存到项目，但编导稿版本已变化；请在最新分镜中重新选择。" });
      return;
    }
    setSceneImagePicker({
      ...target, loading: false, error: undefined,
      options: [{ id: assetId, title: upload.title || upload.fileName, origin: "上传",
        previewUrl: upload.previewUrl }],
    });
    setSceneSourceProgress({ sceneId: target.sceneId, stage: "图片已就绪，请确认是否用于这一镜" });
  }, []);

  const waitForUploadedSourceReady = useCallback(async (
    conversationId: string,
    uploadId: string,
    assetId: number,
    allowInitialUntracked = false,
    acceptedUpload?: ChatImageUpload,
  ) => {
    if (!token) return;
    let firstPoll = true;
    while (workspaceMountedRef.current) {
      const stillTracked = (chatImageUploadsRef.current[conversationId] ?? []).some((item) => (
        item.id === uploadId && item.assetId === assetId && item.status === "processing"
      ));
      if (!stillTracked && !(allowInitialUntracked && firstPoll)) return;
      try {
        const job = await assetWorkspaceAdapter.getLatestAssetIngestJob(token, assetId);
        if (job.status === "completed") {
          const trackedUpload = (
            chatImageUploadsRef.current[conversationId] ?? []
          ).find((item) => item.id === uploadId && item.assetId === assetId)
            ?? (allowInitialUntracked && firstPoll ? acceptedUpload : undefined);
          if (trackedUpload?.fileKind === "image" && job.understanding_status !== "ready") {
            const error = sceneUploadUnderstandingFailure(job.understanding_failure_category);
            if (trackedUpload.sceneUploadTarget) {
              setSceneSourceProgress({ sceneId: trackedUpload.sceneUploadTarget.sceneId,
                stage: "素材理解失败", error });
            }
            setChatImageUploads((current) => ({ ...current,
              [conversationId]: (current[conversationId] ?? []).map((item) =>
                item.id === uploadId ? { ...item, status: "failed", error } : item),
            }));
            return;
          }
          let refreshed: Conversation | undefined;
          if (conversationId !== "new" && trackedUpload && (
            trackedUpload.fileKind === "image" || trackedUpload.fileKind === "source"
            || trackedUpload.videoPurpose === "visual_material" || trackedUpload.sceneUploadTarget
          )) {
            refreshed = await persistReadyVisualMaterial(
              conversationId,
              assetId,
              trackedUpload.title || trackedUpload.fileName,
            );
          }
          if (trackedUpload?.sceneUploadTarget) offerReadySceneUpload(trackedUpload, assetId, refreshed);
          setChatImageUploads((current) => ({
            ...current,
            [conversationId]: (current[conversationId] ?? []).map((item) =>
              item.id === uploadId ? { ...item, status: "ready", uploadProgress: 100, error: undefined } : item
            )
          }));
          return;
        }
        if (job.status === "failed") {
          setChatImageUploads((current) => ({
            ...current,
            [conversationId]: (current[conversationId] ?? []).map((item) =>
              item.id === uploadId ? { ...item, status: "failed", error: job.error_message || "资料解析失败。" } : item
            )
          }));
          return;
        }
      } catch {
        // A transient status-read failure must not invalidate an accepted upload.
      }
      firstPoll = false;
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
  }, [offerReadySceneUpload, persistReadyVisualMaterial, token]);

  const uploadChatImage = async (conversationId: string, upload: ChatImageUpload) => {
    if (!runtimeWriteCapabilities.canUpload || !token || !assetWorkspaceAdapter.isBackendEnabled()) return;
    const controller = new AbortController();
    const videoPurpose = upload.videoPurpose ?? "creation_source";
    const isVisualMaterialVideo = upload.fileKind === "video" && videoPurpose === "visual_material";
    const isLocalConversationVideo = upload.fileKind === "video" && Boolean(upload.file) && !upload.sourceUrl;
    const usesOrdinaryVideoUpload = isVisualMaterialVideo || isLocalConversationVideo;
    if (upload.fileKind === "video" && !usesOrdinaryVideoUpload) {
      longFormSourceControllersRef.current.set(upload.id, controller);
    }
    try {
      const onProgress = (uploadProgress: number | null) => {
        setChatImageUploads((current) => ({
          ...current,
          [conversationId]: (current[conversationId] ?? []).map((item) => (
            item.id === upload.id ? { ...item, uploadProgress } : item
          ))
        }));
      };
      let asset;
      if (upload.fileKind === "video" && !usesOrdinaryVideoUpload) {
        const input = upload.sourceUrl
          ? { kind: "url" as const, url: upload.sourceUrl }
          : upload.file
            ? { kind: "file" as const, file: upload.file }
            : null;
        if (!input) throw new Error("没有可上传的视频来源。");
        asset = await prepareLongFormComposerSource({
          token,
          input,
          signal: controller.signal,
          onProgress,
        });
      } else {
        if (!upload.file) throw new Error("没有可上传的资料。");
        if (usesOrdinaryVideoUpload) {
          asset = await assetWorkspaceAdapter.uploadAsset(
            token,
            upload.file,
            "video",
            onProgress,
            upload.idempotencyKey,
          );
        } else {
          asset = await assetWorkspaceAdapter.uploadAsset(
            token,
            upload.file,
            upload.fileKind === "source" ? "assets" : upload.fileKind,
            onProgress,
            upload.idempotencyKey,
          );
        }
      }
      const acceptedUpload: Pick<ChatImageAttachment, "assetId" | "fileKind" | "status"> = {
        assetId: asset.id,
        fileKind: upload.fileKind,
        status: (
          (upload.fileKind === "video" && !usesOrdinaryVideoUpload)
          || !("status" in asset)
          || asset.status === "ready"
        ) ? "ready" : "processing",
      };
      if (upload.fileKind === "image" && acceptedUpload.status === "ready") {
        const metadata = "metadata" in asset && asset.metadata
          && typeof asset.metadata === "object" ? asset.metadata as Record<string, unknown> : null;
        const understanding = metadata && typeof metadata.understanding === "object"
          ? metadata.understanding as Record<string, unknown> : null;
        if (understanding?.status !== "ready") {
          const ingest = await assetWorkspaceAdapter.getLatestAssetIngestJob(token, asset.id)
            .catch(() => null);
          const error = sceneUploadUnderstandingFailure(ingest?.understanding_failure_category);
          if (upload.sceneUploadTarget) {
            setSceneSourceProgress({ sceneId: upload.sceneUploadTarget.sceneId,
              stage: "素材理解失败", error });
          }
          setChatImageUploads((current) => ({ ...current,
            [conversationId]: (current[conversationId] ?? []).map((item) =>
              item.id === upload.id ? { ...item, assetId: asset.id, title: asset.title || item.fileName,
                status: "failed", uploadProgress: 100, error } : item),
          }));
          return;
        }
      }
      if (conversationId !== "new" && (
        isVisualMaterialVideo || upload.sceneUploadTarget
        || upload.fileKind === "image" || upload.fileKind === "source"
      ) && acceptedUpload.status === "ready") {
        const refreshed = await persistReadyVisualMaterial(
          conversationId,
          asset.id,
          asset.title || upload.fileName,
        );
        if (upload.sceneUploadTarget) offerReadySceneUpload({ ...upload, title: asset.title || upload.fileName }, asset.id, refreshed);
      }
      setChatImageUploads((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((item) =>
          item.id === upload.id
            ? {
              ...item,
              assetId: asset.id,
              title: asset.title || item.fileName,
              status: acceptedUpload.status,
              uploadProgress: 100,
              error: undefined
            }
            : item
        )
      }));
      if (shouldImmediatelyReconcileAcceptedUpload(acceptedUpload)) {
        const reconciliationKey = `${conversationId}:${upload.id}:${asset.id}`;
        inFlightSourceAttachmentReconciliationsRef.current.add(reconciliationKey);
        void waitForUploadedSourceReady(conversationId, upload.id, asset.id, true,
          { ...upload, assetId: asset.id, title: asset.title || upload.fileName })
          .finally(() => inFlightSourceAttachmentReconciliationsRef.current.delete(reconciliationKey));
      }
      setLibraryRefreshKey((value) => value + 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      reportRuntimeWriteFailure(error);
      const msg = error instanceof Error ? error.message : "资料上传失败。";
      setChatImageUploads((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).map((item) =>
          item.id === upload.id ? { ...item, status: "failed", error: msg } : item
        )
      }));
    } finally {
      if (upload.fileKind === "video" && !usesOrdinaryVideoUpload) {
        longFormSourceControllersRef.current.delete(upload.id);
      }
    }
  };

  useEffect(() => {
    if (!token) return;
    for (const candidate of pendingAttachmentReconciliationKeys(chatImageUploads)) {
      if (inFlightSourceAttachmentReconciliationsRef.current.has(candidate.key)) continue;
      inFlightSourceAttachmentReconciliationsRef.current.add(candidate.key);
      void waitForUploadedSourceReady(candidate.conversationId, candidate.uploadId, candidate.assetId)
        .finally(() => inFlightSourceAttachmentReconciliationsRef.current.delete(candidate.key));
    }
  }, [chatImageUploads, token, waitForUploadedSourceReady]);

  const handleRemoveChatImage = (attachmentId: string) => {
    longFormSourceControllersRef.current.get(attachmentId)?.abort();
    longFormSourceControllersRef.current.delete(attachmentId);
    setChatImageUploads((current) => ({
      ...current,
      [selectedConversation.id]: (current[selectedConversation.id] ?? []).filter((item) => item.id !== attachmentId)
    }));
  };

  const handleRetryChatImage = (attachmentId: string) => {
    const upload = (chatImageUploads[selectedConversation.id] ?? []).find((item) => item.id === attachmentId);
    if (!upload) return;
    const conversationId = selectedConversation.id;
    setChatImageUploads((current) => ({
      ...current,
      [selectedConversation.id]: (current[selectedConversation.id] ?? []).map((item) =>
        item.id === attachmentId ? { ...item,
          status: upload.sceneUploadTarget && upload.assetId ? "processing" : "uploading",
          uploadProgress: upload.sceneUploadTarget && upload.assetId ? 100 : 0,
          error: undefined } : item
      )
    }));
    if (upload.sceneUploadTarget && upload.assetId && token) {
      void (async () => {
        try {
          const reparsed = await assetWorkspaceAdapter.reparseAsset(token, upload.assetId!);
          const understanding = reparsed.metadata?.understanding;
          if (!understanding || typeof understanding !== "object"
            || (understanding as Record<string, unknown>).status !== "ready") {
            throw new Error("视觉理解仍未完成，请稍后重试。图片原件已保留。");
          }
          const refreshed = await persistReadyVisualMaterial(
            conversationId, upload.assetId!, upload.title || upload.fileName,
          );
          offerReadySceneUpload(upload, upload.assetId!, refreshed);
          setChatImageUploads((current) => ({ ...current,
            [conversationId]: (current[conversationId] ?? []).map((item) =>
              item.id === attachmentId ? { ...item, status: "ready", error: undefined } : item),
          }));
        } catch (error) {
          const message = `图片已保存，但重新解析失败：${formatComposerError(error)}。原分镜保持不变。`;
          setSceneSourceProgress({ sceneId: upload.sceneUploadTarget!.sceneId,
            stage: "素材理解失败", error: message });
          setChatImageUploads((current) => ({ ...current,
            [conversationId]: (current[conversationId] ?? []).map((item) =>
              item.id === attachmentId ? { ...item, status: "failed", error: message } : item),
          }));
        }
      })();
      return;
    }
    void uploadChatImage(conversationId, upload);
  };

  const handleImportVideoUrl = useStableCallback((sourceUrl: string) => {
    if (!runtimeWriteCapabilities.canUpload || !token || !assetWorkspaceAdapter.isBackendEnabled()) {
      toast.error("请先登录并配置后端后再添加视频链接。");
      return;
    }
    const targetConversationId = selectedConversation.readonly ? "new" : selectedConversation.id;
    if ((chatImageUploadsRef.current[targetConversationId] ?? []).some((item) => item.fileKind === "video")) {
      toast.error("每次请只添加一个视频。");
      return;
    }
    const upload: ChatImageUpload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      idempotencyKey: createUploadIdempotencyKey(),
      sourceUrl,
      fileName: "网络视频链接",
      fileKind: "video",
      videoPurpose: "creation_source",
      title: "网络视频",
      status: "uploading",
      uploadProgress: null,
    };
    setChatImageUploads((current) => ({
      ...current,
      [targetConversationId]: [...(current[targetConversationId] ?? []), upload],
    }));
    setSelectedConversationId(targetConversationId);
    setActiveView("conversation");
    void uploadChatImage(targetConversationId, upload);
  });

  const materialPackageAsset = async (conversationId: string): Promise<ConversationContextAsset | null> => {
    if (!runtimeWriteCapabilities.canPersist || !token || !assetWorkspaceAdapter.isBackendEnabled()) return null;
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
      .filter((upload) => (upload.fileKind === "source" || upload.fileKind === "video") && upload.status === "ready" && upload.assetId)
      .map((upload) => ({ id: upload.assetId!, title: upload.title || upload.fileName }))
  );

  const handleSendConversationMessage = async (
    conversation: Conversation,
    instruction: string,
    signal?: AbortSignal,
    linkedAssets: ConversationContextAsset[] = [],
    clientRequestId?: string,
    videoParameterConfirmation?: AssetVideoParameterConfirmation,
    agentConfirmationId?: string,
    longFormAction?: AssetLongFormAction,
    videoSceneReplacement?: AssetVideoSceneReplacement,
    presenterDirectionConfirmation?: AssetPresenterDirectionConfirmation,
    presenterDirectionRequest?: AssetPresenterDirectionRequest,
    presenterCleanupConfirmation?: AssetPresenterCleanupConfirmation,
    presenterAudioSelectionConfirmation?: AssetPresenterAudioSelectionConfirmation,
    confirmationProductId?: number,
    sourceSubtitleMode?: "translated_zh" | "source" | "bilingual",
    videoProjectConfirmation?: AssetVideoProjectConfirmation,
    creativeDirectionSelection?: AssetCreativeDirectionSelection,
    imageGenerationRequest?: AssetImageGenerationRequest,
    imageGenerationConfirmation?: AssetImageGenerationConfirmation,
    imageGenerationApplication?: AssetImageGenerationApplication,
    imageGenerationSetApplication?: AssetImageGenerationSetApplication,
    sourceResolutionSelection?: AssetSourceResolutionSelection,
    subtitleOperation?: AssetSubtitleOperation,
  ) => {
    if (conversation.readonly) {
      throw new Error("参考样例只读，不能继续对话。");
    }
    if (!runtimeWriteCapabilities.canGenerate || !token || !assetWorkspaceAdapter.isBackendEnabled()) {
      throw new Error("请先登录并配置后端后再使用 AI 生成。");
    }
    const effectiveLongFormAction = longFormAction;
    const selectedBackendAssetId = effectiveLongFormAction?.kind === "analyze"
      ? undefined
      : subtitleOperation?.assetId ?? confirmationProductId ?? selectedProduct?.backendAssetId;
    const directorProductionPlan: AssetDirectorProductionPlan | undefined =
      instruction.trim() === "完善制作方案"
      && selectedProduct?.contentType === "video_script"
      && selectedBackendAssetId != null
      && selectedProduct.backendAssetId === selectedBackendAssetId
      && typeof selectedProduct.contentHash === "string"
      && selectedProduct.contentHash.length > 0
      && selectedProduct.metadata?.director_draft_phase === "editable_reviewed"
        ? { directorAssetId: selectedBackendAssetId, baseContentHash: selectedProduct.contentHash }
        : undefined;
    const focusedScene = !agentConfirmationId && !directorProductionPlan && !subtitleOperation && selectedBackendAssetId != null
      ? resolveSelectedSceneFocus(
        selectedProduct, selectedBackendAssetId, clickedSceneFocus[selectedBackendAssetId],
      )
      : undefined;
    let assetsForSend = linkedAssets;
    if (assetsForSend.length === 0) {
      const sourceAssets = sourceAttachmentAssets(conversation.id);
      const packageAsset = await materialPackageAsset(conversation.id);
      assetsForSend = packageAsset ? [...sourceAssets, packageAsset] : sourceAssets;
    }
    const contextAssets = conversationContextAssets[conversation.id]
      ?? persistedConversationContextAssets(conversation.messages ?? []);
    const combinedContextAssets = mergeConversationContextAssets(contextAssets, assetsForSend);
    const combinedLinkedAssetIds = combinedContextAssets.map((asset) => asset.id);
    // Persist the first project's opt-out before any video planning starts.
    const createdProjectId = conversation.id === "new" && creativeProfileVisible && newConversationIgnoreProfile
      ? await createCreativeProject(token, true)
      : null;
    const optimisticConversationId = conversation.id === "new"
      ? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : null;
    if (optimisticConversationId) {
      const baseConversation = assetWorkspaceAdapter.getNewConversation();
      const optimisticConversation: Conversation = {
        ...baseConversation,
        id: optimisticConversationId,
        readonly: false,
        title: instruction.slice(0, 36) || "新建项目",
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
    let result;
    try {
      result = await assetWorkspaceAdapter.sendMessage({
        token,
        conversationId: createdProjectId ?? optimisticConversationId ?? conversation.id,
        instruction,
        selectedProductId: selectedBackendAssetId,
        selectedSceneId: focusedScene?.sceneId,
        selectedSceneVersionId: focusedScene?.versionId ?? undefined,
        linkedAssetIds: combinedLinkedAssetIds,
        clientRequestId,
        videoParameterConfirmation,
        subtitleOperation,
        videoProjectConfirmation,
        agentConfirmationId,
        longFormAction: effectiveLongFormAction,
        videoSceneReplacement,
        presenterDirectionConfirmation,
        presenterDirectionRequest,
        creativeDirectionSelection,
        imageGenerationRequest,
        imageGenerationConfirmation,
        imageGenerationApplication,
        imageGenerationSetApplication,
        presenterCleanupConfirmation,
        presenterAudioSelectionConfirmation,
        sourceSubtitleMode,
        sourceResolutionSelection,
        directorProductionPlan,
        signal
      });
    } catch (error) {
      reportRuntimeWriteFailure(error);
      if (
        clientRequestId
        && !signal?.aborted
        && error instanceof Error
        && error.message === API_CONNECTION_ERROR
      ) {
        try {
          result = await assetWorkspaceAdapter.reconcileMessage({
            token, clientRequestId,
            conversationId: createdProjectId ?? optimisticConversationId ?? conversation.id,
          });
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
        const message = formatComposerError(error);
        setConversations((current) => current.map((item) => {
          if (item.id !== optimisticConversationId) return item;
          return {
            ...item,
            id: createdProjectId ?? item.id,
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
        if (createdProjectId) {
          selectedConversationIdRef.current = createdProjectId;
          setSelectedConversationId(createdProjectId);
        }
      }
      throw error;
      }
    }
    if (signal?.aborted) return;
    if (createdProjectId) setNewConversationIgnoreProfile(false);
    const {
      conversationId: targetConversationId,
      conversation: persistedConversation,
      product,
      generationJob,
      agentAction,
      requirementSnapshot,
    } = result;
    if (requirementSnapshot) {
      storeRequirementSnapshot(targetConversationId, requirementSnapshot);
    }
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
      handleSelectConversation(targetConversationId);
    }
    if (generationJob && generationJob.status !== "completed") {
      registerAssetGenerationJob(targetConversationId, generationJob);
    }
    if (agentAction) {
      const key = agentActionLiveKey(targetConversationId, agentAction.id);
      const live = { conversationId: targetConversationId, action: agentAction };
      agentActionsRef.current = {
        ...agentActionsRef.current,
        [key]: live,
      };
      setAgentActions((current) => ({
        ...current,
        [key]: live,
      }));
    }
    if (targetConversationId !== conversation.id && combinedLinkedAssetIds.length > 0) {
      setConversationContextAssets((current) => {
        const next = { ...current };
        next[targetConversationId] = mergeConversationContextAssets(
          next[targetConversationId] ?? [],
          combinedContextAssets,
        );
        if (conversation.id === "new" || conversation.id.startsWith("draft-")) {
          delete next[conversation.id];
        }
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
    const preserveEditingFocus = shouldKeepFocusOnResult && productCanLeaveSilentlyRef.current?.() === false;
    const editingProductId = preserveEditingFocus ? selectedProductIdRef.current : null;
    setSelectedProductIds((current) => {
      if (editingProductId) return { ...current, [targetConversationId]: editingProductId };
      if (product) {
        return {
          ...current,
          [targetConversationId]: product.id
        };
      }
      return current;
    });
    if (shouldKeepFocusOnResult) {
      setActiveView("conversation");
    }
    setConversationLoadRevision((value) => value + 1);
  };

  const handleImportDirectorDraft = async (
    row: LibraryRow,
    referenceAssetIds: number[],
    legacyReferenceMappings: Record<string, number>,
  ) => {
    const projectId = libraryTargetProjectId ?? selectedConversation.id;
    if (!token || projectId === "new" || !runtimeWriteCapabilities.canPersist) {
      throw new Error("请先打开已保存的项目，再导入编导稿。");
    }
    const draft = await assetWorkspaceAdapter.importDirectorDraft({
      token, source: row, conversationId: projectId,
      referenceAssetIds, legacyReferenceMappings,
    });
    await refreshProjectConversation(projectId);
    setSelectedProductIds((current) => ({ ...current, [projectId]: `asset-${draft.id}` }));
    setLibraryTargetProjectId(null);
    handleSelectConversation(projectId);
    toast.success("已导入可编辑编导稿；请核对旧素材编号并重新审查。");
  };

  const handleOpenGenerationSourceScene = (sourceAssetId: number, sceneId: string) => {
    const conversation = selectedConversation;
    const source = (conversation.products ?? [conversation.product]).find(
      (product) => product.backendAssetId === sourceAssetId,
    );
    const plan = source?.metadata?.video_plan;
    const scenes = plan && typeof plan === "object" && !Array.isArray(plan)
      ? (plan as Record<string, unknown>).scenes : undefined;
    if (!source || !Array.isArray(scenes) || !scenes.some(
      (scene) => scene && typeof scene === "object" && (scene as Record<string, unknown>).id === sceneId,
    )) {
      toast.error("原编导稿或分镜已变化，请刷新项目后重新选择。");
      return;
    }
    const versionId = latestProductVersionId(source);
    if (!versionId) {
      toast.error("原编导稿最新版本尚未就绪，请刷新后重试。");
      return;
    }
    setSelectedProductIds((current) => ({ ...current, [conversation.id]: source.id }));
    setClickedSceneFocus((current) => ({
      ...current,
      [sourceAssetId]: { sceneId, versionId },
    }));
    window.requestAnimationFrame(() => {
      const scene = document.querySelector(`[data-scene-source-id="${sceneId}"]`);
      const sceneList = scene?.closest("details[data-scene-source-list]");
      if (sceneList instanceof HTMLDetailsElement) sceneList.open = true;
      if (scene && "scrollIntoView" in scene) scene.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const handleSceneSourceAction = async (action: SceneSourceAction) => {
    if (sceneSourceBusyRef.current) return;
    const director = selectedProduct;
    const conversation = selectedConversation;
    const directorAssetId = director?.backendAssetId;
    const directorVersionId = director ? latestProductVersionId(director) : null;
    if (!token || !directorAssetId || !directorVersionId || conversation.readonly || isConversationSnapshot) {
      setSceneSourceProgress({ sceneId: action.sceneId, stage: "无法操作", error: "当前编导稿或版本尚未就绪，请刷新后重试。" });
      return;
    }
    if (action.kind === "use_asset" && sceneImagePicker && (
      sceneImagePicker.conversationId !== conversation.id
      || sceneImagePicker.sceneId !== action.sceneId
      || sceneImagePicker.directorAssetId !== directorAssetId
      || sceneImagePicker.directorVersionId !== directorVersionId
    )) {
      setSceneSourceProgress({ sceneId: action.sceneId, stage: "分镜已更新",
        error: "编导稿版本已变化，请在最新分镜中重新选择图片。" });
      setSceneImagePicker(null);
      return;
    }
    if (action.kind === "choose_asset") {
      setSceneImagePicker({ conversationId: conversation.id, sceneId: action.sceneId,
        directorAssetId, directorVersionId, options: [], loading: true });
      try {
        const resources = [];
        for (const [kind, scope] of [["source", "active"], ["cover", "all"]] as const) {
          let offset = 0;
          while (true) {
            const page = await getProjectResources(token, conversation.id, kind, scope, offset, 50);
            resources.push(...page.items);
            offset += page.items.length;
            if (!page.items.length || offset >= page.total) break;
          }
        }
        const options = new Map<number, { id: number; title: string; previewUrl?: string; origin: "上传" | "生成" }>();
        for (const item of resources) {
          if (item.asset_kind !== "image" || item.status !== "ready"
            || !["upload", "generated"].includes(item.source_type)
            || (item.source_type === "upload" && item.understanding_status !== "ready")
            || ["do_not_use", "rights_unclear", "reference_only"].includes(item.use_policy ?? "")) continue;
          options.set(item.id, {
            id: item.id, title: item.title,
            origin: item.source_type === "generated" ? "生成" : "上传",
          });
        }
        for (const product of conversation.products ?? []) {
          if (product.mode !== "image" || !Array.isArray(product.metadata?.generated_images)) continue;
          for (const frame of product.metadata.generated_images) {
            if (!frame || typeof frame !== "object" || Array.isArray(frame)) continue;
            const image = frame as Record<string, unknown>;
            const id = image.asset_id;
            if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) continue;
            const storageRef = typeof image.storage_ref === "string" ? image.storage_ref : "";
            const previewUrl = /^(?:local|supabase|s3):\/\/(?:[^/]+\/)?content-assets\/\d+\/generation-jobs\/\d+\/images\/[a-f0-9]{64}\.png$/.test(storageRef)
              ? `${API_BASE}/v1/video/media?ref=${encodeURIComponent(storageRef)}` : undefined;
            options.set(id, {
              id, title: typeof image.intent === "string" && image.intent.trim() ? image.intent : product.title,
              origin: "生成", previewUrl,
            });
          }
        }
        try {
          const library = await assetWorkspaceAdapter.listLibrary(token, "image", "", { limit: 100 });
          for (const row of library.rows) {
            if (!row.assetId || !options.has(row.assetId)) continue;
            const existing = options.get(row.assetId)!;
            options.set(row.assetId, {
              ...existing,
              previewUrl: existing.previewUrl ?? row.previewUrl ?? row.thumbnailUrl,
            });
          }
        } catch {
          // The scoped project list remains usable if the library preview is unavailable.
        }
        setSceneImagePicker((current) => current?.sceneId === action.sceneId && current.conversationId === conversation.id
          ? { conversationId: conversation.id, sceneId: action.sceneId,
            directorAssetId, directorVersionId, options: [...options.values()], loading: false }
          : current);
      } catch (error) {
        setSceneImagePicker((current) => current?.sceneId === action.sceneId && current.conversationId === conversation.id
          ? { ...current, loading: false, error: formatComposerError(error) }
          : current);
      }
      return;
    }
    const plan = director.metadata?.video_plan;
    const decisions = plan && typeof plan === "object" && !Array.isArray(plan)
      ? (plan as Record<string, unknown>).scene_source_decisions : undefined;
    const existing = Array.isArray(decisions)
      ? decisions.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).scene_id === action.sceneId)
      : undefined;
    const currentStatus = existing && typeof existing === "object"
      ? (existing as Record<string, unknown>).status : undefined;
    if (action.kind === "generate_image" || action.kind === "upload_asset" || action.kind === "revise_scene") {
      const scenes = plan && typeof plan === "object" && !Array.isArray(plan)
        ? (plan as Record<string, unknown>).scenes : undefined;
      const sceneIndex = Array.isArray(scenes)
        ? scenes.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === action.sceneId)
        : -1;
      if (sceneIndex < 0) {
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "无法操作", error: "当前分镜已变化，请刷新后再选择。" });
        return;
      }
      setClickedSceneFocus((current) => ({
        ...current,
        [directorAssetId]: { sceneId: action.sceneId, versionId: directorVersionId },
      }));
      const number = sceneIndex + 1;
      const scene = Array.isArray(scenes) && scenes[sceneIndex] && typeof scenes[sceneIndex] === "object"
        ? scenes[sceneIndex] as Record<string, unknown> : {};
      if (action.kind === "generate_image") {
        sceneSourceBusyRef.current = true;
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "正在为本镜提交图片候选生成" });
        try {
          const result = await assetWorkspaceAdapter.sendMessage({
            token, conversationId: conversation.id,
            instruction: sceneImageGenerationUtterance(scene, number),
            selectedProductId: directorAssetId,
            clientRequestId: globalThis.crypto.randomUUID(),
            sceneImageGenerationRequest: {
              directorAssetId, directorVersionId, sceneId: action.sceneId,
            },
          });
          setConversations((current) => current.map((item) => item.id === conversation.id ? result.conversation : item));
          if (result.generationJob) registerAssetGenerationJob(conversation.id, result.generationJob);
          setSceneSourceProgress({ sceneId: action.sceneId, stage: "图片候选生成中；完成后请自行选择是否应用" });
        } catch (error) {
          reportRuntimeWriteFailure(error);
          setSceneSourceProgress({ sceneId: action.sceneId, stage: "图片候选未启动", error: formatComposerError(error) });
        } finally {
          sceneSourceBusyRef.current = false;
        }
        return;
      }
      if (action.kind === "upload_asset") {
        sceneUploadTargetRef.current = { conversationId: conversation.id,
          directorAssetId, directorVersionId, sceneId: action.sceneId };
        sceneUploadInputRef.current?.click();
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "请选择图片；上传完成后再确认是否用于本镜" });
        return;
      }
      const utterance = `请重新设计第 ${number} 镜的画面创意，保持本镜和整片时长、旁白及其他镜头不变，并先让我确认新方案。`;
      window.dispatchEvent(new CustomEvent("multimix:composer-prepare", {
        detail: { utterance },
      }));
      setSceneSourceProgress(null);
      return;
    }
    sceneSourceBusyRef.current = true;
    setSceneSourceProgress({ sceneId: action.sceneId, stage: "正在核对当前编导稿版本" });
    let waitingTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const refresh = async () => {
        const loaded = await assetWorkspaceAdapter.loadConversationDetail(token, conversation.id);
        setConversations((current) => current.map((item) => item.id === conversation.id ? loaded : item));
        setConversationLoadRevision((value) => value + 1);
        const versions = loaded.products?.length ? loaded.products : [loaded.product];
        const current = versions.find((item) => item.backendAssetId === directorAssetId);
        const nextVersionId = current ? latestProductVersionId(current) : null;
        if (!nextVersionId) throw new Error("编导稿最新版本尚未就绪，请刷新后重试。");
        return nextVersionId;
      };
      let boundVersion = directorVersionId;
      if (action.kind === "search" && currentStatus !== "search_requested" || action.kind === "keep") {
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "正在记录逐镜来源决定" });
        const decision = {
          directorAssetId, directorVersionId: boundVersion,
          sceneId: action.sceneId,
          action: action.kind === "keep" ? "keep_current" as const : "search_public" as const,
        };
        const response = await assetWorkspaceAdapter.sendMessage({
          token, conversationId: conversation.id,
          instruction: action.kind === "keep" ? `第 ${action.sceneId} 镜保留当前方案` : `第 ${action.sceneId} 镜尝试搜索公共素材`,
          selectedProductId: directorAssetId,
          sceneSourceDecision: decision,
        });
        setConversations((current) => current.map((item) => item.id === conversation.id ? response.conversation : item));
        boundVersion = await refresh();
      }
      if (action.kind === "search") {
        const startedAt = Date.now();
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "正在规划搜索词并核验素材候选" });
        waitingTimer = setInterval(() => {
          const seconds = Math.floor((Date.now() - startedAt) / 1000);
          if (seconds >= 15) setSceneSourceProgress({
            sceneId: action.sceneId,
            stage: `正在规划搜索词并核验素材候选，已等待 ${seconds} 秒；响应较慢，可稍后刷新查看结果`,
          });
        }, 5000);
        await assetWorkspaceAdapter.searchScenePublicCandidate(token, {
          directorAssetId, directorVersionId: boundVersion,
          sceneId: action.sceneId, action: "search_public",
        });
        await refresh();
      } else if (action.kind === "select") {
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "正在核对原片并应用到这一镜" });
        await assetWorkspaceAdapter.selectScenePublicCandidate(token, {
          directorAssetId, directorVersionId: boundVersion,
          sceneId: action.sceneId, action: "search_public",
        }, action.candidateId);
        await refresh();
      } else if (action.kind === "use_asset") {
        setSceneSourceProgress({ sceneId: action.sceneId, stage: "正在核对图片并应用到这一镜" });
        await assetWorkspaceAdapter.sendMessage({
          token, conversationId: conversation.id,
          instruction: `第 ${action.sceneId} 镜使用我选择的项目图片`,
          selectedProductId: directorAssetId,
          sceneSourceDecision: {
            directorAssetId, directorVersionId: boundVersion,
            sceneId: action.sceneId, action: "use_saved_asset",
            sourceAssetId: action.assetId,
          },
        });
        await refresh();
        setSceneImagePicker(null);
      }
      setSceneSourceProgress(null);
    } catch (error) {
      reportRuntimeWriteFailure(error);
      setConversationLoadRevision((value) => value + 1);
      if (action.kind === "search") {
        try {
          const loaded = await assetWorkspaceAdapter.loadConversationDetail(token, conversation.id);
          setConversations((current) => current.map((item) => item.id === conversation.id ? loaded : item));
          const versions = loaded.products?.length ? loaded.products : [loaded.product];
          const current = versions.find((item) => item.backendAssetId === directorAssetId);
          const currentPlan = current?.metadata?.video_plan;
          const decisions = currentPlan && typeof currentPlan === "object" && !Array.isArray(currentPlan)
            ? (currentPlan as Record<string, unknown>).scene_source_decisions : undefined;
          if (Array.isArray(decisions) && decisions.some((item) =>
            item && typeof item === "object"
            && (item as Record<string, unknown>).scene_id === action.sceneId
            && (item as Record<string, unknown>).status === "no_candidate"
          )) {
            setSceneSourceProgress(null);
            return;
          }
        } catch {
          // The original search error remains visible if readback is unavailable.
        }
      }
      setSceneSourceProgress({
        sceneId: action.sceneId,
        stage: "逐镜操作未完成",
        error: `${formatComposerError(error)} 原方案仍可查看，请刷新后核对状态。`,
      });
    } finally {
      if (waitingTimer) clearInterval(waitingTimer);
      sceneSourceBusyRef.current = false;
    }
  };

  const handleApplyCreativeDirection = useStableCallback(async (
    product: ProductArtifact,
    selection: AssetCreativeDirectionSelection,
  ) => {
    const conversation = conversationsRef.current.find(
      (item) => item.id === selectedConversationIdRef.current,
    );
    if (!conversation || !product.backendAssetId) {
      throw new Error("当前编导稿已切换，请在最新版本中重新选择方向。");
    }
    await handleSendConversationMessage(
      conversation,
      "应用此方向",
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      product.backendAssetId,
      undefined,
      undefined,
      selection,
    );
  });

  const handleLongFormSelect = useStableCallback(async (action: LongFormSourceAction) => {
    const conversation = conversationsRef.current.find(
      (item) => item.id === selectedConversationIdRef.current,
    );
    if (!conversation || selectedProduct?.backendAssetId !== action.analysisAssetId) {
      toast.error("候选已切换，请在当前拆条结果中重新选择。");
      return;
    }
    const metadata = selectedProduct.metadata ?? {};
    const analysis = longFormAnalysisFromMetadata(metadata);
    const candidate = action.kind === "select"
      ? analysis?.candidates.find((item) => item.id === action.candidateId)
      : undefined;
    const instruction = action.kind === "preserve"
      ? "完整保留原意"
      : candidate?.title
        ? `把候选「${candidate.title}」提炼成短片`
        : "把选中的候选提炼成短片";
    try {
      await handleSendConversationMessage(
        conversation,
        instruction,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        action,
      );
    } catch (error) {
      toast.error(formatComposerError(error));
    }
  });

  const handleUploadClick = () => {
    if (!runtimeWriteCapabilities.canUpload || !token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setUploadError("请先登录并配置后端后再上传资料。");
      return;
    }
    setUploadError(null);
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (file: File | undefined) => {
    if (!file || !runtimeWriteCapabilities.canUpload || !token || activeView === "conversation") return;
    setUploading(true);
    setUploadError(null);
    try {
      await assetWorkspaceAdapter.uploadAsset(token, file, activeView, undefined, createUploadIdempotencyKey());
      setLibraryRefreshKey((value) => value + 1);
    } catch (error) {
      reportRuntimeWriteFailure(error);
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

  const stableHandleUploadClick = useStableCallback(handleUploadClick);
  const stableHandleUseLibraryAsset = useStableCallback(handleUseLibraryAsset);
  const stableHandleImportDirectorDraft = useStableCallback(handleImportDirectorDraft);
  const stableHandleAddAssetToConversation = useStableCallback(handleAddAssetToConversation);
  const loadSelectedProjectResources = useCallback(async (
    kind: ProjectResourceKind,
    scope: ProjectResourceScope,
    offset: number,
    limit: number,
  ) => {
    if (!token || selectedConversation.id === "new") {
      throw new Error("当前项目尚未保存。");
    }
    const page = await getProjectResources(
      token,
      selectedConversation.id,
      kind,
      scope,
      offset,
      limit,
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        membershipState: item.membership_state,
        historicalReferenceCount: item.historical_reference_count,
        status: item.status,
        readdStatus: item.readd_status ?? null,
        assetKind: item.asset_kind,
        contentType: item.content_type,
        sourceType: item.source_type,
        contentRole: item.content_role ?? null,
        usePolicy: item.use_policy ?? null,
        updatedAt: item.updated_at,
      })),
    };
  }, [selectedConversation.id, token]);

  const changeSelectedProjectSource = async (assetId: number, action: "add" | "remove") => {
    if (!token || selectedConversation.id === "new") return;
    const projectId = selectedConversation.id;
    if (action === "add") {
      await addProjectSource(token, projectId, assetId);
    } else {
      await removeProjectSource(token, projectId, assetId);
      setConversationContextAssets((current) => ({
        ...current,
        [projectId]: (current[projectId] ?? []).filter((asset) => asset.id !== assetId),
      }));
    }
    invalidateProjectResourceSummary(projectId);
    requirementReadGenerationRef.current.set(projectId, (requirementReadGenerationRef.current.get(projectId) ?? 0) + 1);
    const completedAction = action === "add" ? "已重新加入项目并保存" : "已移出项目并保存";
    try {
      await refreshProjectConversation(projectId, true);
    } catch {
      markProjectDetailRefreshFailed(projectId);
      toast.info(`${completedAction}，但资料暂未同步。请重试加载。`);
      return;
    }
    try {
      const { snapshot, synced } = await reloadCurrentRequirements(projectId);
      if (snapshot && !synced) toast.info(`${completedAction}，但需求理解暂未同步。`);
    } catch {
      invalidateProjectRequirements(projectId);
      setRequirementRefreshErrorProjectId(projectId);
      toast.info(`${completedAction}，但需求理解暂未同步。`);
    }
  };

  const handleOpenProjectResource = (item: ProjectResourceItem) => {
    if (item.kind !== "source" && isConversationSnapshot) {
      toast.info("对话内容尚未加载，请重试加载后查看这个产物。", { id: "project-resource-detail-pending" });
      return;
    }
    // Only one focus-isolating surface may be active during cross-drawer navigation.
    setProjectResourcesOpen(false);
    navigateWorkspace(() => {
      if (item.kind === "source") {
        setLibraryTargetProjectId(null);
        setLibraryFocusedAssetId(item.id);
        setActiveView(item.assetKind === "video" ? "video" : item.assetKind === "image" ? "image" : "assets");
      } else {
        const product = (selectedConversation.products ?? []).find((candidate) => (
          candidate.backendAssetId === item.id
        ));
        if (product) {
          setSelectedProductIds((current) => ({
            ...current,
            [selectedConversation.id]: product.id,
          }));
        }
      }
    }, () => setProjectResourcesOpen(true));
  };

  const effectiveSidebarState = isNarrowViewport ? narrowNavigationOpen ? "expanded" : "auto" : sidebarState;
  const isSidebarVisuallyCollapsed = effectiveSidebarState === "auto" && isNarrowViewport;
  const navigationSlot = isNarrowViewport ? (
    <button
      className="shadcn-prototype-topbar-sidebar-toggle"
      type="button"
      aria-label="展开侧边栏"
      aria-haspopup="dialog"
      aria-expanded={narrowNavigationOpen}
      aria-controls="workspace-navigation"
      title="展开侧边栏"
      onClick={(event) => {
        navigationTriggerRef.current = event.currentTarget;
        handleExpandSidebar();
      }}
    >
      <PanelLeftOpen size={16} aria-hidden="true" />
    </button>
  ) : null;

  const shellClassName = [
    "shadcn-prototype-shell",
    "agent-visual-refresh",
    effectiveSidebarState === "collapsed" ? "sidebar-collapsed" : "",
    effectiveSidebarState === "expanded" ? "sidebar-expanded" : "",
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

  return (
    <main className={shellClassName}>
      <div
        ref={navigationDialogRef}
        id="workspace-navigation"
        className="shadcn-prototype-navigation-surface"
        role={isNarrowViewport && narrowNavigationOpen ? "dialog" : undefined}
        aria-modal={isNarrowViewport && narrowNavigationOpen ? true : undefined}
        aria-label={isNarrowViewport && narrowNavigationOpen ? "工作台导航" : undefined}
        hidden={isNarrowViewport && !narrowNavigationOpen}
        tabIndex={-1}
      >
      {isNarrowViewport && narrowNavigationOpen ? (
        <button type="button" className="shadcn-prototype-navigation-backdrop" aria-label="关闭导航遮罩"
          tabIndex={-1} onClick={handleCollapseSidebar} />
      ) : null}
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
          <Link className="shadcn-prototype-home" href="/" aria-label="返回主页" title="返回主页"
            onClick={(event) => { event.preventDefault(); navigateWorkspace(() => router.push("/")); }}>
            <House size={15} aria-hidden="true" />
          </Link>
          <button
            ref={navigationCloseRef}
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
            <Link className="shadcn-prototype-collapsed-rail-button" href="/" aria-label="返回主页" title="返回主页"
              onClick={(event) => { event.preventDefault(); navigateWorkspace(() => router.push("/")); }}>
              <House size={17} aria-hidden="true" />
            </Link>
          </div>

          <div className="shadcn-prototype-collapsed-rail-group">
            <button
              className={activeView === "conversation" && selectedConversation.id === "new" ? "shadcn-prototype-collapsed-rail-button active accent" : "shadcn-prototype-collapsed-rail-button accent"}
              type="button"
              aria-label="新建项目"
              title="新建项目"
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
              onClick={() => navigateView("assets")}
            >
              <Package size={17} aria-hidden="true" />
            </button>
            <button
              className={activeView === "copy" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="文案库"
              title="文案库"
              onClick={() => navigateView("copy")}
            >
              <FileText size={17} aria-hidden="true" />
            </button>
            <button
              className={activeView === "image" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="图片库"
              title="图片库"
              onClick={() => navigateView("image")}
            >
              <ImageIcon size={17} aria-hidden="true" />
            </button>
            <button
              className={activeView === "video" ? "shadcn-prototype-collapsed-rail-button active" : "shadcn-prototype-collapsed-rail-button"}
              type="button"
              aria-label="视频库"
              title="视频库"
              onClick={() => navigateView("video")}
            >
              <Video size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="shadcn-prototype-collapsed-rail-user" aria-label="账户">
            {creativeProfileVisible ? (
              <button type="button" title="创作档案" aria-label="创作档案" onClick={handleOpenCreativeProfile}>
                <span title={accountEmail}>{getConversationMonogram(accountEmail)}</span>
              </button>
            ) : <span title={accountEmail}>{getConversationMonogram(accountEmail)}</span>}
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
          新建项目
        </button>

        <div className="shadcn-prototype-conversation-section">
          <div className="shadcn-prototype-section-title">
            <span>最近项目</span>
          </div>
          {conversationLoadState === "ready" && conversations.length > 0 ? (
            <label className="shadcn-prototype-project-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索项目"
                placeholder="搜索项目"
                value={projectSearchQuery}
                onChange={(event) => setProjectSearchQuery(event.currentTarget.value)}
              />
              {projectSearchQuery ? (
                <button type="button" aria-label="清除项目搜索" onClick={() => setProjectSearchQuery("")}>
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </label>
          ) : null}
          <div className="shadcn-prototype-conversation-list">
            {conversationLoadState === "loading" ? (
              <div className="shadcn-prototype-conversation-state" role="status">正在加载你的项目…</div>
            ) : conversationLoadState === "unconfigured" ? (
              <div className="shadcn-prototype-conversation-state">
                <strong>创作服务尚未连接</strong>
                <span>请联系管理员完成配置后重试。</span>
              </div>
            ) : conversationLoadState === "error" ? (
              <div className="shadcn-prototype-conversation-state" role="alert">
                <strong>项目加载失败</strong>
                <span>你的项目没有改变，请重新加载。</span>
                <button type="button" onClick={() => setConversationLoadRevision((value) => value + 1)}>重新加载</button>
              </div>
            ) : visibleConversationRows.length === 0 && projectSearchQuery.trim() ? (
              <div className="shadcn-prototype-conversation-state">
                <strong>没有找到匹配项目</strong>
                <span>换一个关键词，或清除搜索查看全部项目。</span>
                <button type="button" onClick={() => setProjectSearchQuery("")}>清除搜索</button>
              </div>
            ) : visibleConversationRows.length === 0 ? (
              <div className="shadcn-prototype-conversation-state">
                <strong>还没有项目</strong>
                <span>从“新建项目”开始第一次创作。</span>
              </div>
            ) : null}
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
                      aria-label="重命名项目"
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
                    {projectListStateLabel(conversation.projectState) ? (
                      <small className={`shadcn-prototype-project-state ${conversation.projectState}`}>
                        {projectListStateLabel(conversation.projectState)}
                      </small>
                    ) : null}
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
                    {conversation.id === selectedConversation.id && requirementSnapshots[conversation.id] ? (
                      <button
                        type="button"
                        disabled={!runtimeWriteCapabilities.canPersist}
                        onClick={() => void handleCloneProjectFromRequirements(conversation)}
                      >
                        <Plus size={13} aria-hidden="true" />
                        基于当前需求新建项目
                      </button>
                    ) : null}
                    <button type="button" disabled={!runtimeWriteCapabilities.canPersist} onClick={() => handleStartRenameConversation(conversation)}>
                      <Pencil size={13} aria-hidden="true" />
                      重命名
                    </button>
                    <button type="button" disabled={!runtimeWriteCapabilities.canPersist} onClick={() => {
                      if (conversation.id === selectedConversation.id) navigateWorkspace(() => handleDeleteConversation(conversation.id));
                      else handleDeleteConversation(conversation.id);
                    }}>
                      <Trash2 size={13} aria-hidden="true" />
                      删除项目
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {conversationLoadState === "ready" && canToggleAllProjectRows ? (
            <button
              className="shadcn-prototype-project-list-toggle"
              type="button"
              aria-expanded={showAllProjectRows}
              onClick={() => setShowAllProjectRows((current) => !current)}
            >
              {showAllProjectRows ? "收起项目" : "查看全部"}
            </button>
          ) : null}
        </div>

        <nav className="shadcn-prototype-nav" aria-label="资源库">
          <span className="shadcn-prototype-nav-title">资源库</span>
          <button
            className={`shadcn-prototype-nav-item assets${activeView === "assets" ? " active" : ""}`}
            type="button"
            aria-label="资产库"
            aria-current={activeView === "assets" ? "page" : undefined}
            title="资产库"
            onClick={() => navigateView("assets")}
          >
            <span className="shadcn-prototype-nav-icon" aria-hidden="true"><Package size={16} /></span>
            资产
          </button>
          <button
            className={`shadcn-prototype-nav-item copy${activeView === "copy" ? " active" : ""}`}
            type="button"
            aria-label="文案库"
            aria-current={activeView === "copy" ? "page" : undefined}
            title="文案库"
            onClick={() => navigateView("copy")}
          >
            <span className="shadcn-prototype-nav-icon" aria-hidden="true"><FileText size={16} /></span>
            文案
          </button>
          <button
            className={`shadcn-prototype-nav-item image${activeView === "image" ? " active" : ""}`}
            type="button"
            aria-label="图片库"
            aria-current={activeView === "image" ? "page" : undefined}
            title="图片库"
            onClick={() => navigateView("image")}
          >
            <span className="shadcn-prototype-nav-icon" aria-hidden="true"><ImageIcon size={16} /></span>
            图片
          </button>
          <button
            className={`shadcn-prototype-nav-item video${activeView === "video" ? " active" : ""}`}
            type="button"
            aria-label="视频库"
            aria-current={activeView === "video" ? "page" : undefined}
            title="视频库"
            onClick={() => navigateView("video")}
          >
            <span className="shadcn-prototype-nav-icon" aria-hidden="true"><Video size={16} /></span>
            视频
          </button>
        </nav>

        <AiBackgroundStatus tasks={backgroundTasks} />

        <div className="shadcn-prototype-user">
          <span className="shadcn-prototype-user-avatar" aria-hidden="true">{getConversationMonogram(accountEmail)}</span>
          <div>
            <strong>{accountName}</strong>
            <em title={accountEmail}>{accountEmail}</em>
            {token && creativeProfileVisible ? <button type="button" className="shadcn-prototype-profile-entry" onClick={handleOpenCreativeProfile}><BookOpen size={12} aria-hidden="true" />创作档案</button> : null}
          </div>
          {onLogout ? (
            <button type="button" className="shadcn-prototype-logout" aria-label="退出登录" title="退出登录" onClick={() => navigateWorkspace(onLogout)}>
              <LogOut size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </aside>
      </div>

      <section className={insetClassName}>
        {activeView !== "conversation" ? (
          <header className="shadcn-prototype-topbar">
            {navigationSlot}
            <div className="shadcn-prototype-breadcrumb">
              <span>资源库</span>
              <span className="shadcn-prototype-library-breadcrumb-separator" aria-hidden="true">/</span>
              <strong>{assetWorkspaceAdapter.getWorkshop(activeView).title}</strong>
            </div>
            <div className="shadcn-prototype-actions">
              {renderDiagnostics()}
              <input
                ref={uploadInputRef}
                type="file"
                accept={uploadAcceptForView(activeView)}
                style={{ display: "none" }}
                disabled={!runtimeWriteCapabilities.canUpload}
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
            activeView === "conversation"
              ? hasProductStage
                ? "shadcn-prototype-workspace conversation-mode"
                : "shadcn-prototype-workspace conversation-only-mode"
                : "shadcn-prototype-workspace workshop-mode"
          }
          style={hasProductStage
            ? { "--chat-panel-width": `${chatPanelWidth}px` } as CSSProperties
            : undefined}
        >
          {isNewConversation ? (
            <ConversationStart
              navigationSlot={navigationSlot}
              suggestions={selectedConversation.suggestions ?? []}
              conversation={selectedConversation}
              accountName={accountName}
              imageAttachments={currentChatImageUploads}
              onUploadImages={handleChatImageUpload}
              onRemoveImageAttachment={handleRemoveChatImage}
              onRetryImageAttachment={handleRetryChatImage}
              onImportVideoUrl={handleImportVideoUrl}
              onSend={handleSendConversationMessage}
              creativeProfileVisible={creativeProfileVisible}
              ignoreProfile={newConversationIgnoreProfile}
              onIgnoreProfileChange={setNewConversationIgnoreProfile}
              token={token}
              writeCapabilities={runtimeWriteCapabilities}
              onRetryWriteAvailability={handleRetryWriteAvailability}
            />
          ) : activeView === "conversation" ? (
            <>
              <ConversationStudio
                navigationSlot={navigationSlot}
                basePath={basePath}
                contextAssets={currentContextAssets}
                selectedConversation={selectedConversation}
                selectedProduct={selectedProduct}
                onSelectProduct={handleSelectProduct}
                onApplyCreativeDirection={
                  !runtimeWriteCapabilities.canGenerate || isConversationSnapshot
                    ? undefined
                    : handleApplyCreativeDirection
                }
                selectedImageFrameIds={selectedImageFrameIds}
                onSelectImageFrame={(productId, frameId) => {
                  setSelectedImageFrameIds((current) => ({ ...current, [productId]: frameId }));
                }}
                imageAttachments={currentChatImageUploads}
                onUploadImages={handleChatImageUpload}
                onRemoveImageAttachment={handleRemoveChatImage}
                onRetryImageAttachment={handleRetryChatImage}
                onImportVideoUrl={handleImportVideoUrl}
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
                generationJobs={selectedAssetGenerationJobs}
                generationJobConnectionLostById={selectedAssetGenerationJobConnectionLostById}
                onRetryGeneration={handleRetryGeneration}
                onCancelGeneration={handleCancelGeneration}
                onOpenGenerationSourceScene={runtimeWriteCapabilities.canGenerate && !isConversationSnapshot
                  ? handleOpenGenerationSourceScene : undefined}
                liveRunStateByAssetId={liveRunStateByAssetId}
                onRetryExecution={handleRetryExecution}
                liveAgentActionsById={liveAgentActionsById}
                onRetryAgentAction={handleRetryAgentAction}
                 diagnosticsSlot={renderDiagnostics()}
                 onOpenProjectResources={() => setProjectResourcesOpen(true)}
                onClearContextAssets={() => {
                  setConversationContextAssets((current) => ({
                    ...current,
                    [selectedConversation.id]: [],
                  }));
                }}
                detailLoadError={conversationDetailErrorId === selectedConversation.id}
                onRetryDetail={() => {
                  setConversationDetailRetryRevision((value) => value + 1);
                  setProjectResourceSummaryRevision((value) => value + 1);
                }}
                readonly={(selectedConversation.readonly ?? false) || isConversationSnapshot}
                writeCapabilities={runtimeWriteCapabilities}
                onRetryWriteAvailability={handleRetryWriteAvailability}
                onLoadBgmCatalog={handleLoadBgmCatalog}
                requirementSnapshot={currentRequirementSnapshot}
                inheritedRequirementNotice={
                  inheritedRequirementNotices[selectedConversation.id] === true
                  || requirementSnapshots[selectedConversation.id]?.triggerKind === "cloned_from_requirements"
                }
                requirementAnalyticsToken={token}
              />
              {displayProduct ? (
                <>
                  <div
                    className="shadcn-prototype-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={isNarrowViewport ? NARROW_CHAT_PANEL_MIN : DESKTOP_CHAT_PANEL_MIN}
                    aria-valuemax={isNarrowViewport ? 640 : DESKTOP_CHAT_PANEL_MAX}
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
                    onSubtitleRequest={runtimeWriteCapabilities.canGenerate && !isConversationSnapshot && !selectedConversation.readonly
                      ? async (operation) => {
                        const instruction = operation.action === "correct_subtitle" ? `修改这条字幕为：${operation.text}`
                          : operation.action === "set_subtitle_visibility" ? operation.subtitlesEnabled ? "在视频中添加字幕" : "关闭视频字幕"
                            : operation.action === "undo_subtitle_edit" ? "撤销上一次字幕修改" : `恢复字幕版本 ${operation.subtitleRevision}`;
                        await handleSendConversationMessage(selectedConversation, instruction, undefined, [], globalThis.crypto.randomUUID(),
                          undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                          operation.assetId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, operation);
                      } : undefined}
                    onRegisterBeforeLeave={registerProductBeforeLeave}
                    copied={copiedProductId === displayProduct.id}
                    onCopyProduct={handleCopyProduct}
                    onSaveProduct={isConversationSnapshot
                      ? async () => { toast.info("完整对话仍在加载，请稍后再保存修改。"); }
                      : handleSaveProduct}
                    onRestoreVersion={isConversationSnapshot
                      ? async () => { toast.info("完整项目仍在加载，请稍后再基于历史版本继续。"); }
                      : handleRestoreProductVersion}
                    onProductUpdated={(updatedProduct, baseProduct) => {
                    if (updatedProduct.backendAssetId) {
                      setClickedSceneFocus((current) => {
                        const next = { ...current };
                        delete next[updatedProduct.backendAssetId!];
                        return next;
                      });
                    }
                      if (baseProduct) {
                        setConversations((current) => reconcileProductMutation(current, selectedConversation.id, baseProduct, updatedProduct));
                        return;
                      }
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
                    onRetryVideoJob={!runtimeWriteCapabilities.canGenerate
                      ? undefined
                      : isConversationSnapshot
                        ? async () => { toast.info("完整对话仍在加载，请稍后再重试任务。"); }
                        : handleRetryVideoJob}
                    onOpenLongFormCandidates={(candidateProduct) => {
                      handleSelectProduct(selectedConversation.id, candidateProduct.id);
                    }}
                    onLongFormAction={(action) => void handleLongFormSelect(action)}
                    onApplyGeneratedImage={
                      !canApplyExistingGeneratedImage
                        ? undefined
                        : handleApplyGeneratedImage
                    }
                    onApplyGeneratedImageSet={
                      !canApplyExistingGeneratedImage
                        ? undefined
                        : handleApplyGeneratedImageSet
                    }
                    selectedImageFrameId={selectedImageFrameIds[displayProduct.id]}
                    onSelectedImageFrameChange={(frameId) => {
                      setSelectedImageFrameIds((current) => ({ ...current, [displayProduct.id]: frameId }));
                    }}
                  onSelectSegment={(segment: AssetProductSegment) => {
                    if (!displayProduct.backendAssetId) return;
                    setClickedSceneFocus((current) => ({
                      ...current,
                      [displayProduct.backendAssetId!]: {
                        sceneId: segment.id,
                        versionId: latestProductVersionId(displayProduct),
                      },
                    }));
                  }}
                  onSceneSourceAction={runtimeWriteCapabilities.canGenerate && !isConversationSnapshot ? handleSceneSourceAction : undefined}
                  onContinueDirectorProduction={runtimeWriteCapabilities.canGenerate && !isConversationSnapshot
                    ? async () => {
                      try {
                        await handleSendConversationMessage(selectedConversation, "完善制作方案");
                      } catch (error) {
                        toast.error(formatComposerError(error));
                      }
                    }
                    : undefined}
                  sceneSourceProgress={sceneSourceProgress}
                    product={displayProduct}
                    savedVersion={savedVersionForProduct(displayProduct, savedProductIds[displayProduct.id])}
                    savingProduct={productMutationStates[displayProduct.id] === "saving"}
                    restoringProduct={productMutationStates[displayProduct.id] === "restoring"}
                    refreshingProduct={productMutationStates[displayProduct.id] === "refreshing"}
                    productSaveConflict={productSaveConflicts[displayProduct.id]?.baseUpdatedAt === displayProduct.backendUpdatedAt
                      ? productSaveConflicts[displayProduct.id]?.message : undefined}
                    onReloadProduct={handleReloadProduct}
                    selectedConversation={selectedConversation}
                    token={token}
                    creativeProfileVisible={creativeProfileVisible}
                    videoJobLive={displayProduct.backendAssetId ? videoJobLive[displayProduct.backendAssetId] ?? null : null}
                  />
                </>
              ) : null}
            </>
          ) : (
            <LibraryWorkspaceErrorBoundary key={activeView}>
              <LibraryWorkshop
                view={activeView}
                token={token}
                refreshRevision={libraryRefreshKey}
                onUploadClick={stableHandleUploadClick}
                uploading={uploading}
                onUseAsset={stableHandleUseLibraryAsset}
                onImportDirectorDraft={stableHandleImportDirectorDraft}
                importProjectTitle={libraryTargetProjectId
                  ? conversations.find((item) => item.id === libraryTargetProjectId)?.title ?? null
                  : selectedConversation.id !== "new" ? selectedConversation.title : null}
                onAddAssetToConversation={stableHandleAddAssetToConversation}
                onAssetArchived={handleLibraryAssetArchived}
                targetProjectTitle={libraryTargetProjectTitle}
                focusAssetId={libraryFocusedAssetId}
                onFocusAssetClose={closeLibraryFocusedAsset}
                onExitProjectTarget={() => {
                  setLibraryTargetProjectId(null);
                  setActiveView("conversation");
                }}
                writeCapabilities={runtimeWriteCapabilities}
                onRetryWriteAvailability={handleRetryWriteAvailability}
                onWriteAvailabilityChange={handleWriteAvailabilityChange}
              />
            </LibraryWorkspaceErrorBoundary>
          )}
        </div>
      </section>
      <input
        ref={sceneUploadInputRef}
        type="file"
        accept="image/*"
        aria-label="上传图片用于指定分镜"
        style={{ display: "none" }}
        disabled={!runtimeWriteCapabilities.canUpload}
        onChange={(event) => {
          const target = sceneUploadTargetRef.current;
          sceneUploadTargetRef.current = null;
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (target && file) handleChatImageUpload([file], target);
        }}
      />
      {sceneImagePicker && sceneImagePicker.conversationId === selectedConversation.id ? (
        <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15, 23, 42, .45)", display: "grid", placeItems: "center" }}>
          <section role="dialog" aria-modal="true" aria-label="为分镜选择项目图片" style={{ background: "white", borderRadius: 16, padding: 20, width: "min(680px, 92vw)", maxHeight: "80vh", overflow: "auto" }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <h2>为这一镜选择图片</h2>
              <button type="button" onClick={() => setSceneImagePicker(null)} aria-label="关闭选图">关闭</button>
            </header>
            <p>图片已保留在项目。先选一张查看它与本镜目标的适配建议，确认后才会修改分镜；也可以暂不采用，或先修改本镜画面。</p>
            {sceneImagePicker.loading ? <p role="status">正在读取项目图片</p> : null}
            {sceneImagePicker.error ? <p role="alert">{sceneImagePicker.error}</p> : null}
            {!sceneImagePicker.loading && !sceneImagePicker.error && !sceneImagePicker.options.length ? <p>项目里暂无可选择的图片。可上传图片或先生成图片候选。</p> : null}
            <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, listStyle: "none", padding: 0 }}>
              {sceneImagePicker.options.map((option) => (
                <li key={option.id}>
                  <button type="button" disabled={sceneSourceBusyRef.current} onClick={() => {
                    const target = sceneImagePicker;
                    if (!token) {
                      setSceneImagePicker((current) => current === target
                        ? { ...current, selectedOptionId: option.id, fitBlocked: true,
                          fitError: "登录状态已失效，请重新登录后选择图片。" }
                        : current);
                      return;
                    }
                    setSceneImagePicker((current) => current === target
                      ? { ...current, selectedOptionId: option.id, fitLoading: true,
                        fit: undefined, fitError: undefined, fitBlocked: false }
                      : current);
                    void assetWorkspaceAdapter.reviewSceneImageFit(token, option.id, {
                      conversation_id: target.conversationId,
                      director_asset_id: target.directorAssetId,
                      director_version_id: target.directorVersionId,
                      scene_id: target.sceneId,
                    }).then((fit) => {
                      setSceneImagePicker((current) => current?.sceneId === target.sceneId
                        && current.directorVersionId === target.directorVersionId
                        && current.selectedOptionId === option.id
                        ? { ...current, fitLoading: false,
                          fit: fit.source_asset_id === option.id
                            && fit.director_version_id === target.directorVersionId
                            && fit.scene_id === target.sceneId ? fit : undefined,
                          fitError: fit.source_asset_id === option.id
                            && fit.director_version_id === target.directorVersionId
                            && fit.scene_id === target.sceneId ? undefined : "适配结果已过期，请重新选择图片。",
                          fitBlocked: fit.source_asset_id !== option.id
                            || fit.director_version_id !== target.directorVersionId
                            || fit.scene_id !== target.sceneId }
                        : current);
                    }).catch((error) => {
                      setSceneImagePicker((current) => current?.sceneId === target.sceneId
                        && current.directorVersionId === target.directorVersionId
                        && current.selectedOptionId === option.id
                        ? { ...current, fitLoading: false, fitBlocked: true,
                          fitError: `适配请求未完成：${formatComposerError(error)}。请重选图片后再试，当前分镜未改变。` }
                        : current);
                    });
                  }} aria-pressed={sceneImagePicker.selectedOptionId === option.id} style={{ width: "100%", textAlign: "left" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated project media */}
                    {option.previewUrl ? <img src={option.previewUrl} alt={option.title} style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover" }} /> : <span aria-hidden="true"><ImageIcon size={32} /></span>}
                    <strong>{option.title}</strong><br /><small>{option.origin}图片 #{option.id}</small>
                  </button>
                </li>
              ))}
            </ul>
            {sceneImagePicker.selectedOptionId ? (
              <div aria-label="本镜图片适配建议">
                {sceneImagePicker.fitLoading ? <p role="status">正在判断图片与本镜画面目标是否匹配…</p> : null}
                {sceneImagePicker.fitError ? <p role="alert">{sceneImagePicker.fitError}</p> : null}
                {sceneImagePicker.fit ? (
                  <div>
                    <p>{sceneImagePicker.fit.status === "match" ? "建议：适合本镜"
                      : sceneImagePicker.fit.status === "partial" ? "建议：部分符合本镜目标"
                        : sceneImagePicker.fit.status === "mismatch" ? "建议：与本镜目标不符"
                          : "视觉服务暂无法判断，本镜是否采用由你决定。"}</p>
                    {sceneImagePicker.fit.evidence ? <p>{sceneImagePicker.fit.evidence}</p> : null}
                    {sceneImagePicker.fit.missing_required_elements.length ? <p>还缺少：{sceneImagePicker.fit.missing_required_elements.join("、")}</p> : null}
                    {sceneImagePicker.fit.excluded_elements_present.length ? <p>出现不应有的元素：{sceneImagePicker.fit.excluded_elements_present.join("、")}</p> : null}
                    {sceneImagePicker.fit.technical_quality?.publishable === false ? <p>画质风险：{sceneImagePicker.fit.technical_quality.reason || "当前图片不适合直接发布"}</p> : null}
                  </div>
                ) : null}
                {sceneImagePicker.fit && (sceneImagePicker.fit.excluded_elements_present.length > 0
                  || sceneImagePicker.fit.technical_quality?.publishable === false)
                  ? <p role="alert">这张图有禁用元素或画质不合格，请换图或修改本镜画面。</p> : null}
                {!sceneImagePicker.fitLoading && !sceneImagePicker.fitBlocked
                  && !sceneImagePicker.fit?.excluded_elements_present.length
                  && sceneImagePicker.fit?.technical_quality?.publishable !== false
                  ? <button type="button" onClick={() => void handleSceneSourceAction({ kind: "use_asset", sceneId: sceneImagePicker.sceneId, assetId: sceneImagePicker.selectedOptionId! })}>{sceneImagePicker.fit?.status === "mismatch" ? "仍用于本镜（画面目标可能不符）" : "确认用于本镜"}</button> : null}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <button type="button" onClick={() => {
                setSceneSourceProgress({ sceneId: sceneImagePicker.sceneId,
                  stage: "图片留在项目，当前分镜没有改变" });
                setSceneImagePicker(null);
              }}>暂不用于本镜，留在项目</button>
              <button type="button" onClick={() => {
                const sceneId = sceneImagePicker.sceneId;
                setSceneImagePicker(null);
                void handleSceneSourceAction({ kind: "revise_scene", sceneId });
              }}>先修改本镜画面</button>
            </div>
            {sceneSourceProgress?.sceneId === sceneImagePicker.sceneId ? (
              <p role={sceneSourceProgress.error ? "alert" : "status"}>{sceneSourceProgress.error ?? sceneSourceProgress.stage}</p>
            ) : null}
          </section>
        </div>
      ) : null}
      {projectResourcesOpen && selectedConversation.id !== "new" ? <ProjectResourcesDrawer
        key={selectedConversation.id}
        open
        projectTitle={selectedConversation.title}
        summary={projectResourceSummary}
        requirementRefreshError={requirementRefreshErrorProjectId === selectedConversation.id}
        onRetryRequirements={() => retryProjectRequirements(selectedConversation.id)}
        loadResources={loadSelectedProjectResources}
        onClose={() => setProjectResourcesOpen(false)}
        onRemoveSource={(assetId) => changeSelectedProjectSource(assetId, "remove")}
        onReaddSource={(assetId) => changeSelectedProjectSource(assetId, "add")}
        onOpenResource={handleOpenProjectResource}
        onUseSourceForNextMessage={selectedConversationHasDetail
          && !selectedConversation.readonly
          && runtimeWriteCapabilities.canGenerate ? (item) => {
          if (item.kind !== "source" || item.membershipState !== "active") return;
          setConversationContextAssets((current) => ({
            ...current,
            [selectedConversation.id]: [{ id: item.id, title: item.title }],
          }));
          setProjectResourcesOpen(false);
          toast.info(`已将「${item.title}」用于本轮。`);
        } : undefined}
      /> : null}
      <ProjectTargetPicker
        open={Boolean(projectTargetRow)}
        projects={projectTargetOptions}
        submittingProjectId={submittingProjectId}
        onSelect={(projectId) => {
          if (projectTargetRow) void persistLibraryAssetToProject(projectTargetRow, projectId);
        }}
        onClose={() => setProjectTargetRow(null)}
        onCreateProject={() => {
          setProjectTargetRow(null);
          handleStartConversation();
        }}
      />
      {creativeProfileVisible && creativeProfileOpen && token ? <CreativeProfilePanel token={token} onClose={closeCreativeProfile} /> : null}
    </main>
  );
}
