"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Play, Square, Video } from "lucide-react";
import { attachmentSendBlockReason, chatAttachmentStatusLabel, getConversationProducts, shouldSubmitComposerOnEnter, type ChatAttachmentFileKind, type ChatAttachmentStatus, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import {
  CHAT_IMAGE_UPLOAD_ACCEPT,
  CHAT_SOURCE_UPLOAD_ACCEPT,
  CHAT_VIDEO_UPLOAD_ACCEPT,
  chatAttachmentRejectionMessage,
  partitionChatAttachmentFiles,
} from "../lib/chat-attachment-policy";
import { supportedLongFormUrlFromText } from "../lib/long-form-composer-source";
import { mergeVisibleConversationMessages, optimisticVideoProjectSteps, shouldRenderMessageBody } from "../lib/conversation-execution-presentation";
import { resolveSuggestionClickIntent } from "../lib/suggestion-actions";
import {
  formatComposerError,
  MESSAGE_NOT_SUBMITTED_ERROR,
  VIDEO_WRITES_PAUSED,
  VIDEO_WRITES_PAUSED_MESSAGE,
  type AssetGenerationJobResponse,
} from "../../../lib/api";
import type {
  AgentActionRunResponse,
  AgentRunStep,
  AssetConversationMessage,
  AssetLongFormAction,
  AssetMessagePlan,
  AssetMessagePresentation,
  AssetPlanBgmCatalog,
  AssetPlanConfirmationValues,
  AssetPresenterAudioSelectionConfirmation,
  AssetPresenterDirectionConfirmation,
  AssetPresenterDirectionRequest,
  AssetPresenterCleanupConfirmation,
  AssetVideoSceneReplacement,
  AssetVideoParameterConfirmation,
  AssetVideoProjectConfirmation,
} from "../lib/asset-workspace-types";
import ConfirmCard from "./confirm-card";
import AgentRunTimeline from "./agent-run-timeline";
import AgentTaskStrip from "./agent-task-strip";
import { AssistantReplyPending, ConversationDetailSkeleton } from "./conversation-waiting-state";
import { AssetGenerationJobCard } from "./asset-generation-job-card";
import LongFormComposerPrompt from "./long-form-composer-prompt";
import {
  DEFAULT_RUNTIME_WRITE_CAPABILITIES,
  type RuntimeWriteCapabilities,
} from "../lib/runtime-write-capabilities";

type VisibleConversationMessage = AssetConversationMessage & { pending?: boolean };

type OptimisticExchange = {
  id: string;
  userText: string;
  assistantText: string;
  status: "pending" | "stopped" | "failed" | "unsubmitted";
  clientRequestId?: string;
  presentation?: AssetMessagePresentation;
  runSteps?: AgentRunStep[];
  confirmationPlanKey?: string;
};

type OptimisticFeedback = Pick<OptimisticExchange, "assistantText" | "presentation" | "runSteps" | "confirmationPlanKey">;

type ActiveRequest = {
  controller: AbortController;
  conversationId: string;
  persistOnConversationSwitch: boolean;
};

export type ChatImageAttachment = {
  id: string;
  fileName: string;
  title: string;
  status: ChatAttachmentStatus;
  fileKind: ChatAttachmentFileKind;
  uploadProgress?: number | null;
  assetId?: number;
  previewUrl?: string;
  error?: string;
};

const IMAGE_ONLY_INSTRUCTION = "请先总结这些图片素材，并询问我想做短视频、文案还是封面方案。";
const DOC_ONLY_INSTRUCTION = "请先阅读这些资料，并询问我想基于它做视频、文案还是总结。";
const ATTACHMENT_HELP_TEXT = "图片会作为素材，PDF/文档会作为来源资产；添加视频后请先说明想怎么处理。";
const COMPOSER_MIN_HEIGHT = 36;
const COMPOSER_MAX_HEIGHT = 128;
const ADJUST_HINT_PLACEHOLDER = "说说想怎么调整，比如换个开场、缩短时长、改用某个素材…";

function generationJobFromMessage(message: AssetConversationMessage): AssetGenerationJobResponse | null {
  const metadata = message.metadata ?? {};
  const id = typeof metadata.asset_generation_job_id === "string" ? metadata.asset_generation_job_id : "";
  const status = metadata.asset_generation_status;
  if (!id || !["queued", "running", "completed", "failed", "cancelled"].includes(String(status))) return null;
  const progress = Array.isArray(metadata.asset_generation_progress)
    ? metadata.asset_generation_progress.filter((event): event is NonNullable<AssetGenerationJobResponse["progress_events"]>[number] => Boolean(event && typeof event === "object" && typeof (event as Record<string, unknown>).key === "string" && typeof (event as Record<string, unknown>).label === "string" && typeof (event as Record<string, unknown>).status === "string" && typeof (event as Record<string, unknown>).occurred_at === "string")).map((event) => ({ ...event, detail: typeof event.detail === "string" ? event.detail : "" }))
    : [];
  return {
    id,
    status: status as AssetGenerationJobResponse["status"],
    result_asset_id: typeof metadata.product_id === "number" ? metadata.product_id : null,
    error_message: status === "failed" || status === "cancelled" ? message.text : null,
    created_at: "",
    updated_at: "",
    started_at: typeof metadata.asset_generation_started_at === "string" ? metadata.asset_generation_started_at : null,
    progress_events: progress,
  };
}

function confirmationPlanKey(plan: AssetMessagePlan): string {
  return [
    plan.kind ?? "",
    plan.confirmationId ?? "",
    plan.title,
    plan.confirmUtterance ?? plan.confirmLabel ?? "",
    plan.fields.map((field) => field.key + ":" + field.value).join("|"),
  ].join("::");
}

function conversationMessageKey(message: VisibleConversationMessage, index: number): string {
  // A server message can be promoted in place from an execution placeholder to
  // a different confirmation card. Include the card's semantic identity so
  // React never keeps the first confirmation's local UI instance for the
  // independent video-project confirmation.
  if (typeof message.id === "number") return `message-${message.id}`;
  return message.plan
    ? `${message.role}-${index}-${confirmationPlanKey(message.plan)}`
    : `${message.role}-${index}`;
}

function visibleSuggestions(message: VisibleConversationMessage) {
  if (message.suggestionActions?.length) {
    return message.suggestionActions.map((action) => ({
      key: action.id,
      label: action.label,
      utterance: action.utterance,
      actionType: action.actionType,
      isAiPrimary: action.isAiPrimary === true,
      enabled: action.enabled,
      disabledReason: action.disabledReason
    }));
  }
  return (message.suggestions ?? []).map((suggestion) => ({
    key: suggestion,
    label: suggestion,
    utterance: suggestion,
    actionType: "fill_composer",
    isAiPrimary: false,
    enabled: true,
    disabledReason: undefined
  }));
}

type CreativeDraftPresentation = {
  title: string;
  message: string;
  missingItems: string[];
  releaseNote: string;
};

function creativeDraftPresentation(message: VisibleConversationMessage): CreativeDraftPresentation | null {
  const value = message.metadata?.creative_draft;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (draft.status !== "needs_information") return null;
  const title = typeof draft.title === "string" ? draft.title.trim() : "";
  const detail = typeof draft.message === "string" ? draft.message.trim() : "";
  const releaseNote = typeof draft.release_note === "string" ? draft.release_note.trim() : "";
  const missingItems = Array.isArray(draft.missing_items)
    ? draft.missing_items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 3)
    : [];
  if (!title || !detail || !releaseNote || !missingItems.length) return null;
  return { title, message: detail, missingItems, releaseNote };
}

function mapProductsToConversationMessages(messages: VisibleConversationMessage[], products: ProductArtifact[]): Map<number, ProductArtifact[]> {
  const result = new Map<number, ProductArtifact[]>();

  messages.forEach((message, index) => {
    if (message.role !== "assistant" || !message.assetId) return;
    const matchedProducts = products.filter((product) => product.backendAssetId === message.assetId);
    if (!matchedProducts.length) return;
    result.set(index, matchedProducts);
  });
  return result;
}

function hasReadyVideoProjectForDirectorScript(
  products: ProductArtifact[],
  directorScriptAssetId: number | null | undefined,
): boolean {
  if (!directorScriptAssetId) return false;
  return products.some((product) => (
    product.contentType === "video_project"
    && product.videoProjectReady === true
    && product.metadata?.director_script_asset_id === directorScriptAssetId
  ));
}

export function resolveExecutionTimelineSteps(
  liveRunState: {
    jobId: string;
    status: string;
    steps: AgentRunStep[];
    errorMessage: string | null;
  } | undefined,
  fallbackSteps: AgentRunStep[] | undefined,
): AgentRunStep[] {
  if (liveRunState?.steps.length) return liveRunState.steps;
  if (liveRunState?.status === "failed") {
    return [{
      key: "execution_failed",
      label: "视频工程生成失败",
      status: "fail",
      retryJobId: liveRunState.jobId,
    }];
  }
  return fallbackSteps ?? [];
}

function agentActionTimelineStatus(
  status: AgentActionRunResponse["status"],
): AgentRunStep["status"] {
  if (status === "queued" || status === "running") return "run";
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "blocked" || status === "canceled") return "fail";
  return "wait";
}

export function resolveAgentActionTimelineSteps(
  action: AgentActionRunResponse | undefined,
  fallbackSteps: AgentRunStep[] | undefined,
): AgentRunStep[] {
  if (!action) return fallbackSteps ?? [];
  const status = agentActionTimelineStatus(action.status);
  const steps = fallbackSteps?.length
    ? fallbackSteps
    : [{ key: action.id, label: "执行视频修改", status }];
  return steps.map((step) => ({
    ...step,
    status,
    retryJobId: status === "fail" && action.retryable ? action.id : undefined,
  }));
}

export default function ConversationStudio({
  basePath,
  contextAssets = [],
  selectedConversation,
  selectedProduct,
  onSelectProduct,
  imageAttachments = [],
  onUploadImages,
  onRemoveImageAttachment,
  onRetryImageAttachment,
  onImportVideoUrl,
  pendingExchange = null,
  onPendingExchangeChange,
  onSendMessage,
  generationJob = null,
  generationJobs = [],
  onRetryGeneration,
  onCancelGeneration,
  liveRunStateByAssetId,
  onRetryExecution,
  liveAgentActionsById,
  onRetryAgentAction,
  diagnosticsSlot = null,
  onOpenProjectResources,
  detailLoadError = false,
  onRetryDetail,
  readonly = false,
  writeCapabilities = DEFAULT_RUNTIME_WRITE_CAPABILITIES,
  onRetryWriteAvailability,
  onLoadBgmCatalog,
}: {
  basePath: string;
  contextAssets?: Array<{ id: number; title: string }>;
  selectedConversation: Conversation;
  selectedProduct: ProductArtifact | null;
  onSelectProduct: (conversationId: string, productId: string) => void;
  imageAttachments?: ChatImageAttachment[];
  onUploadImages?: (files: File[]) => void;
  onRemoveImageAttachment?: (attachmentId: string) => void;
  onRetryImageAttachment?: (attachmentId: string) => void;
  onImportVideoUrl?: (url: string) => void;
  pendingExchange?: OptimisticExchange | null;
  onPendingExchangeChange?: (conversationId: string, exchange: OptimisticExchange | null) => void;
  onSendMessage?: (
    conversation: Conversation,
    instruction: string,
    signal?: AbortSignal,
    linkedAssets?: Array<{ id: number; title: string }>,
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
  ) => Promise<void>;
  generationJob?: AssetGenerationJobResponse | null;
  generationJobs?: AssetGenerationJobResponse[];
  onRetryGeneration?: (jobId: string) => void;
  onCancelGeneration?: (jobId: string) => void;
  // Main execution aggregates keyed by backend asset id. The job id stays bound
  // to the same card while exact failed main/MG child jobs are retried.
  liveRunStateByAssetId?: Record<number, {
    jobId: string;
    status: string;
    steps: AgentRunStep[];
    errorMessage: string | null;
    completionConfirmed: boolean;
  }>;
  onRetryExecution?: (retryJobId: string, executionJobId: string) => void;
  liveAgentActionsById?: Record<string, AgentActionRunResponse>;
  onRetryAgentAction?: (actionRunId: string) => void;
  diagnosticsSlot?: ReactNode;
  onOpenProjectResources?: () => void;
  detailLoadError?: boolean;
  onRetryDetail?: () => void;
  readonly?: boolean;
  writeCapabilities?: RuntimeWriteCapabilities;
  onRetryWriteAvailability?: () => void;
  onLoadBgmCatalog?: (assetId: number) => Promise<AssetPlanBgmCatalog>;
}) {
  const products = getConversationProducts(selectedConversation);
  const [composerValue, setComposerValue] = useState("");
  const [sendErrorNotice, setSendErrorNotice] = useState<{ message: string | null; revision: number }>({
    message: null,
    revision: 0,
  });
  const [sending, setSending] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  // Set when the user clicks a plan's "调整方向": the composer swaps to a guiding
  // placeholder so the click has a visible effect instead of silently focusing.
  const [adjustHint, setAdjustHint] = useState(false);
  const [confirmingPlanKey, setConfirmingPlanKey] = useState<string | null>(null);
  const optimisticExchange = pendingExchange;
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const selectedConversationIdRef = useRef(selectedConversation.id);
  selectedConversationIdRef.current = selectedConversation.id;
  const hasReadyImageAttachment = imageAttachments.some((attachment) => attachment.fileKind === "image" && attachment.status === "ready" && attachment.assetId);
  const hasReadySourceAttachment = imageAttachments.some((attachment) => attachment.fileKind === "source" && attachment.status === "ready" && attachment.assetId);
  const hasReadyVideoAttachment = imageAttachments.some((attachment) => attachment.fileKind === "video" && attachment.status === "ready" && attachment.assetId);
  const canSend = Boolean(onSendMessage) && !readonly && writeCapabilities.canGenerate;
  const canUpload = Boolean(onUploadImages) && !readonly && writeCapabilities.canUpload;
  const runtimeWriteStatusId = writeCapabilities.reason
    ? "multimix-studio-runtime-write-status"
    : undefined;
  const setSendError = useCallback((message: string | null) => {
    setSendErrorNotice((current) => ({
      message,
      revision: message ? current.revision + 1 : current.revision,
    }));
  }, []);
  const sendError = sendErrorNotice.message;

  const conversationMessages = useMemo<VisibleConversationMessage[]>(() => {
    if (selectedConversation.messages && selectedConversation.messages.length > 0) {
      return selectedConversation.messages;
    }
    return [
      { role: "user" as const, text: selectedConversation.prompt },
      { role: "assistant" as const, text: selectedConversation.response },
      { role: "assistant" as const, text: selectedConversation.delivery, suggestions: selectedConversation.suggestions }
    ].filter((message) => message.text.trim() || message.suggestions?.length);
  }, [selectedConversation.delivery, selectedConversation.messages, selectedConversation.prompt, selectedConversation.response, selectedConversation.suggestions]);

  const visibleConversationMessages = useMemo<VisibleConversationMessage[]>(
    () => mergeVisibleConversationMessages(conversationMessages, optimisticExchange),
    [conversationMessages, optimisticExchange]
  );
  // Presenter cleanup is a bound, two-step confirmation.  A legacy generic
  // `submit_message` suggestion may carry only "确认" and cannot include the
  // cleanup plan ID/hash or selected cleanup items.  Keep that unbound shortcut
  // out of the UI while the structured card is the active confirmation path.
  const hasPendingPresenterCleanupConfirmation = visibleConversationMessages.some(
    (message) => message.plan?.kind === "presenter_cleanup_confirmation" && message.plan.status === "pending",
  );

  const productCardsByMessageIndex = useMemo(
    () => mapProductsToConversationMessages(visibleConversationMessages, products),
    [visibleConversationMessages, products]
  );

  const resizeComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`;
    const nextHeight = Math.max(COMPOSER_MIN_HEIGHT, Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  };

  useEffect(() => {
    setSending(false);
    setSendError(null);
    setComposerValue("");
    setAdjustHint(false);
    setConfirmingPlanKey(null);
    return () => {
      const activeRequest = activeRequestRef.current;
      if (activeRequest?.conversationId !== selectedConversation.id) return;
      // Ordinary chat requests keep their existing cancel-on-switch behavior.
      // A video confirmation is a durable command identified by its request ID,
      // so switching views must not turn it into a client-side cancellation.
      if (!activeRequest.persistOnConversationSwitch) {
        activeRequest.controller.abort();
      }
      activeRequestRef.current = null;
    };
  }, [selectedConversation.id, setSendError]);

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  const sendInstruction = async (
    instruction: string,
    optimisticFeedback?: OptimisticFeedback,
    clientRequestId?: string,
    videoParameterConfirmation?: AssetVideoParameterConfirmation,
    agentConfirmationId?: string,
    videoSceneReplacement?: AssetVideoSceneReplacement,
    presenterDirectionConfirmation?: AssetPresenterDirectionConfirmation,
    presenterDirectionRequest?: AssetPresenterDirectionRequest,
    presenterCleanupConfirmation?: AssetPresenterCleanupConfirmation,
    presenterAudioSelectionConfirmation?: AssetPresenterAudioSelectionConfirmation,
    confirmationProductId?: number,
    sourceSubtitleMode?: "translated_zh" | "source" | "bilingual",
    videoProjectConfirmation?: AssetVideoProjectConfirmation,
  ) => {
    const blockReason = attachmentSendBlockReason(imageAttachments);
    if (blockReason) {
      setSendError(blockReason);
      return;
    }
    if (!canSend || !onSendMessage || (!instruction && !hasReadyImageAttachment && !hasReadySourceAttachment) || sending) return;
    const controller = new AbortController();
    const durableRequestId = clientRequestId
      ?? (selectedProduct?.videoProjectReady ? globalThis.crypto.randomUUID() : undefined);
    const requestConversationId = selectedConversation.id;
    activeRequestRef.current = {
      controller,
      conversationId: requestConversationId,
      persistOnConversationSwitch: Boolean(
        durableRequestId
        && (
          optimisticFeedback?.presentation === "execution_anchor"
          || selectedProduct?.videoProjectReady
        )
      ),
    };
    setSending(true);
    setSendError(null);
    setComposerValue("");
    setAdjustHint(false);
    const exchange = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userText: instruction,
      assistantText: optimisticFeedback?.assistantText ?? "",
      status: "pending",
      clientRequestId: durableRequestId,
      presentation: optimisticFeedback?.presentation,
      runSteps: optimisticFeedback?.runSteps,
      confirmationPlanKey: optimisticFeedback?.confirmationPlanKey,
    } satisfies OptimisticExchange;
    onPendingExchangeChange?.(selectedConversation.id, exchange);
    try {
      await onSendMessage(
        selectedConversation,
        instruction,
        controller.signal,
        contextAssets,
        durableRequestId,
        videoParameterConfirmation,
        agentConfirmationId,
        undefined,
        videoSceneReplacement,
        presenterDirectionConfirmation,
        presenterDirectionRequest,
        presenterCleanupConfirmation,
        presenterAudioSelectionConfirmation,
        confirmationProductId,
        sourceSubtitleMode,
        videoProjectConfirmation,
      );
      if (controller.signal.aborted) return;
      onPendingExchangeChange?.(selectedConversation.id, null);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        onPendingExchangeChange?.(selectedConversation.id, exchange ? { ...exchange, assistantText: "已停止生成。", status: "stopped", runSteps: undefined } : null);
        return;
      }
      const message = formatComposerError(error);
      const unsubmitted = error instanceof Error && error.message === MESSAGE_NOT_SUBMITTED_ERROR;
      onPendingExchangeChange?.(selectedConversation.id, exchange ? {
        ...exchange,
        assistantText: message,
        status: unsubmitted ? "unsubmitted" : "failed",
        runSteps: exchange.runSteps?.map((step) => step.status === "run" ? { ...step, status: "fail" } : step)
      } : null);
      if (optimisticFeedback?.presentation !== "execution_anchor") {
        setSendError(message);
      }
    } finally {
      if (activeRequestRef.current?.controller === controller) {
        activeRequestRef.current = null;
      }
      if (selectedConversationIdRef.current === requestConversationId) {
        setSending(false);
      }
    }
  };

  const submitInstruction = async () => {
    const explicitInstruction = composerValue.trim();
    if (hasReadyVideoAttachment && !explicitInstruction) {
      setSendError("请先说明你想怎么处理这段内容。");
      return;
    }
    const instruction = explicitInstruction || (hasReadyImageAttachment ? IMAGE_ONLY_INSTRUCTION : hasReadySourceAttachment ? DOC_ONLY_INSTRUCTION : "");
    await sendInstruction(instruction);
  };

  const handleConfirmPlan = async (
    plan: AssetMessagePlan,
    values?: AssetPlanConfirmationValues,
    confirmationProductId?: number,
  ) => {
    const base = (plan.confirmUtterance ?? plan.confirmLabel ?? "确认，开始生成").trim();
    const isVideoParameterConfirmation = plan.kind === "video_parameter_confirmation";
    const isVideoProjectConfirmation = plan.kind === "video_project_confirmation";
    const isAgentActionConfirmation = plan.kind === "agent_action_confirmation";
    const isPresenterAudioSelectionConfirmation = plan.kind === "presenter_audio_selection_confirmation";
    const isPresenterCleanupConfirmation = plan.kind === "presenter_cleanup_confirmation";
    const ratio = values?.ratio;
    const ratioLabel = ratio ? plan.ratioOptions?.find((option) => option.value === ratio)?.label : undefined;
    const confirmationDetails = [
      ...(!isVideoParameterConfirmation && ratioLabel ? [ratioLabel] : []),
    ];
    const instruction = confirmationDetails.length ? `${base}（${confirmationDetails.join("；")}）` : base;
    // The draft already persists the default mode. Send only a user's explicit
    // non-default choice so the backend can apply it to this first project
    // without changing the existing default-confirmation request shape.
    const sourceSubtitleMode = values?.sourceSubtitleMode
      && values.sourceSubtitleMode !== plan.subtitleDefault
      ? values.sourceSubtitleMode
      : undefined;
    const voiceChoiceRequired = (plan.voiceOptions?.length ?? 0) > 0;
    const voiceChoiceValid = !voiceChoiceRequired || typeof values?.aiVoiceEnabled === "boolean";
    const videoParameterConfirmation = (
      isVideoParameterConfirmation
      && plan.pendingIntentId
      && plan.pendingIntentVersion
      && ratio
      && values?.targetSeconds
      && voiceChoiceValid
    ) ? {
        pendingIntentId: plan.pendingIntentId,
        version: plan.pendingIntentVersion,
        ratio,
        targetSeconds: values.targetSeconds,
        ...(typeof values.aiVoiceEnabled === "boolean"
          ? { aiVoiceEnabled: values.aiVoiceEnabled }
          : {}),
      } : undefined;
    if (isVideoParameterConfirmation && !videoParameterConfirmation) {
      setSendError("视频参数确认信息不完整，请刷新后重试。");
      return;
    }
    if (isAgentActionConfirmation && !plan.confirmationId) {
      setSendError("视频修改确认信息已失效，请刷新后重试。");
      return;
    }
    const presenterCleanupConfirmation = (
      isPresenterCleanupConfirmation
      && plan.cleanupPlanId
      && plan.cleanupPlanHash
      && values?.cleanupCandidateIds
    ) ? {
        cleanupPlanId: plan.cleanupPlanId,
        cleanupPlanHash: plan.cleanupPlanHash,
        selectedCandidateIds: values.cleanupCandidateIds,
        protectedOverrideCandidateIds: values.protectedOverrideCandidateIds ?? [],
        confirmProtectedOverride: values.confirmProtectedOverride === true,
        audioStreamIndex: values.audioStreamIndex,
      } : undefined;
    if (isPresenterCleanupConfirmation && !presenterCleanupConfirmation) {
      setSendError("口播清理确认信息不完整，请刷新后重试。");
      return;
    }
    const selectedAudioOption = plan.audioTrackOptions?.find(
      (option) => option.streamIndex === values?.audioStreamIndex,
    );
    const presenterAudioSelectionConfirmation = (
      isPresenterAudioSelectionConfirmation
      && plan.confirmationId
      && selectedAudioOption?.audioFingerprint
      && selectedAudioOption.transcriptHash
    ) ? {
        confirmationId: plan.confirmationId,
        audioStreamIndex: selectedAudioOption.streamIndex,
        audioFingerprint: selectedAudioOption.audioFingerprint,
        transcriptHash: selectedAudioOption.transcriptHash,
      } : undefined;
    if (isPresenterAudioSelectionConfirmation && !presenterAudioSelectionConfirmation) {
      setSendError("原声音轨确认信息不完整，请刷新后重试。");
      return;
    }
    const bgmConfirmationRequired = isVideoProjectConfirmation
      && Boolean(plan.bgmCatalogVersion)
      && (plan.bgmOptions?.length ?? 0) > 0;
    const bgmEnabled = values?.bgmEnabled;
    const videoProjectConfirmation = (
      bgmConfirmationRequired
      && plan.bgmCatalogVersion
      && typeof bgmEnabled === "boolean"
      && (!bgmEnabled || Boolean(values?.bgmCatalogId))
    ) ? {
        catalogVersion: plan.bgmCatalogVersion,
        enabled: bgmEnabled,
        ...(bgmEnabled && values?.bgmCatalogId
          ? { catalogId: values.bgmCatalogId }
          : {}),
      } : undefined;
    if (bgmConfirmationRequired && !videoProjectConfirmation) {
      setSendError("配乐确认信息不完整，请刷新后重试。");
      return;
    }
    const planKey = confirmationPlanKey(plan);
    setConfirmingPlanKey(planKey);
    try {
      await sendInstruction(instruction, {
        assistantText: isVideoParameterConfirmation
          ? "参数已确认，正在生成编导稿。"
          : isAgentActionConfirmation
            ? "已确认，正在执行视频修改。"
            : isPresenterAudioSelectionConfirmation
              ? "原声已确认，正在生成对应口播清理方案。"
            : "已确认，正在创建视频工程任务。",
        presentation: "execution_anchor",
        runSteps: isAgentActionConfirmation
          ? [{
              key: plan.confirmationId ?? "agent-action-confirmation",
              label: "执行视频修改",
              status: "run",
            }]
          : isPresenterAudioSelectionConfirmation
            ? [{
                key: plan.confirmationId ?? "presenter-audio-selection",
                label: "生成口播清理方案",
                status: "run",
              }]
          : optimisticVideoProjectSteps(),
        confirmationPlanKey: planKey,
      },
      globalThis.crypto.randomUUID(),
      videoParameterConfirmation,
      plan.confirmationId,
      undefined,
      values?.directorCandidateId
        ? {
            directorCandidateId: values.directorCandidateId,
            ...(ratio ? { ratio } : {}),
            ...(values?.sourceSubtitleMode ? { subtitleMode: values.sourceSubtitleMode } : {}),
            ...(values?.targetSeconds ? { targetSeconds: values.targetSeconds } : {}),
          }
        : undefined,
      undefined,
      presenterCleanupConfirmation,
      presenterAudioSelectionConfirmation,
       confirmationProductId,
       sourceSubtitleMode,
       videoProjectConfirmation,
      );
    } finally {
      setConfirmingPlanKey((current) => current === planKey ? null : current);
    }
  };

  const handleAdjustPlan = (plan: AssetMessagePlan, confirmationProductId?: number) => {
    if (
      plan.recommendationMode === "single_winner"
      && plan.directionDefault
      && confirmationProductId
    ) {
      void sendInstruction(
        "换个方向",
        {
          assistantText: "正在准备下一个推荐方向。",
          presentation: "execution_anchor",
          confirmationPlanKey: confirmationPlanKey(plan),
        },
        globalThis.crypto.randomUUID(),
        undefined,
        undefined,
        undefined,
        undefined,
        { currentCandidateId: plan.directionDefault },
        undefined,
        undefined,
        confirmationProductId,
      );
      return;
    }
    // A custom adjust label seeds the composer; the default "调整方向" carries no
    // instruction, so we show a guiding placeholder instead of an empty box —
    // otherwise the click just silently focuses and reads as a dead button.
    const seed = plan.adjustLabel && plan.adjustLabel !== "调整方向" ? plan.adjustLabel : "";
    setComposerValue(seed);
    setAdjustHint(!seed);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      if (composerRef.current) resizeComposer(composerRef.current);
    });
  };

  // Failure cards (and other surfaces) in the product pane recover through the
  // conversation: they dispatch these events instead of prop-drilling send/focus.
  useEffect(() => {
    const onFocusComposer = () => {
      composerRef.current?.focus();
    };
    const onComposerSend = (event: Event) => {
      const detail = (event as CustomEvent<{
        utterance?: string;
        videoSceneReplacement?: AssetVideoSceneReplacement;
        confirmationProductId?: number;
        sourceSubtitleMode?: "translated_zh" | "source" | "bilingual";
      }>).detail;
      const utterance = detail?.utterance;
      if (typeof utterance === "string" && utterance.trim()) {
        void sendInstruction(
          utterance.trim(),
          undefined,
          detail?.videoSceneReplacement ? globalThis.crypto.randomUUID() : undefined,
          undefined,
          undefined,
          detail?.videoSceneReplacement,
          undefined,
          undefined,
          undefined,
          undefined,
          detail?.confirmationProductId,
          detail?.sourceSubtitleMode,
        );
      }
    };
    window.addEventListener("multimix:composer-focus", onFocusComposer);
    window.addEventListener("multimix:composer-send", onComposerSend);
    return () => {
      window.removeEventListener("multimix:composer-focus", onFocusComposer);
      window.removeEventListener("multimix:composer-send", onComposerSend);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation.id, sending, readonly, writeCapabilities.canGenerate]);

  const handleAttachmentFiles = (files: FileList | File[]) => {
    if (!canUpload) return;
    const partition = partitionChatAttachmentFiles(files);
    setSendError(chatAttachmentRejectionMessage(partition));
    if (partition.acceptedFiles.length) {
      onUploadImages?.(partition.acceptedFiles);
    }
  };

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files) handleAttachmentFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleSourceInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files) handleAttachmentFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleVideoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.files) handleAttachmentFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleDrop = (event: DragEvent) => {
    if (!canUpload) return;
    event.preventDefault();
    setIsDraggingUpload(false);
    handleAttachmentFiles(event.dataTransfer.files);
  };

  const stopGeneration = () => {
    if (!sending) return;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    setSending(false);
    if (pendingExchange) {
      onPendingExchangeChange?.(selectedConversation.id, { ...pendingExchange, assistantText: "已停止生成。", status: "stopped" });
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) {
      stopGeneration();
      return;
    }
    await submitInstruction();
  };

  const renderProductCards = (messageIndex: number) => {
    const messageProducts = productCardsByMessageIndex.get(messageIndex) ?? [];
    if (messageProducts.length === 0) return null;
    return (
      <div className="shadcn-prototype-product-card-list" aria-label="对话产物">
        {messageProducts.map((product) => (
          <Link
            className={product.id === selectedProduct?.id ? "shadcn-prototype-product-card active" : "shadcn-prototype-product-card"}
            href={`${basePath}?conversation=${encodeURIComponent(selectedConversation.id)}&product=${encodeURIComponent(product.id)}`}
            key={product.id}
            onClick={(event) => {
              event.preventDefault();
              onSelectProduct(selectedConversation.id, product.id);
            }}
          >
            <span className="shadcn-prototype-context-icon">
              {product.mode === "image" ? (
                <ImageIcon size={15} aria-hidden="true" />
              ) : product.mode === "audio" ? (
                <Play size={14} aria-hidden="true" />
              ) : product.mode === "video" || product.mode === "mg-overlay" ? (
                <Video size={15} aria-hidden="true" />
              ) : (
                <FileText size={15} aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{product.title}</strong>
              <em>{product.phase} · {product.status}</em>
            </span>
            {product.version ? <small>{product.version}</small> : null}
            <span className="shadcn-prototype-product-card-arrow" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </Link>
        ))}
      </div>
    );
  };

  const composerControlClassName = [
    imageAttachments.length ? "shadcn-prototype-composer-control has-attachments" : "shadcn-prototype-composer-control",
    isDraggingUpload ? "drag-active" : ""
  ].filter(Boolean).join(" ");
  const liveGenerationJobs = generationJobs.length
    ? generationJobs
    : generationJob
      ? [generationJob]
      : [];
  const liveGenerationJobsById = new Map(liveGenerationJobs.map((job) => [job.id, job]));
  const anchoredGenerationJobIds = new Set(
    visibleConversationMessages
      .map((message) => generationJobFromMessage(message)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const supersededGenerationJobIds = new Set(
    visibleConversationMessages
      .map((message) => message.metadata?.retry_of_asset_generation_job_id)
      .filter((id): id is string => typeof id === "string" && Boolean(id)),
  );
  const projectResourceCounts: Array<[string, number]> = [
    ["素材", selectedConversation.projectResourceSummary?.sources ?? selectedConversation.projectResources?.sources.length ?? 0],
    ["文案", selectedConversation.projectResourceSummary?.copies ?? selectedConversation.projectResources?.copies.length ?? 0],
    ["封面", selectedConversation.projectResourceSummary?.covers ?? selectedConversation.projectResources?.covers.length ?? 0],
    ["视频", selectedConversation.projectResourceSummary?.videos ?? selectedConversation.projectResources?.videos.length ?? 0],
  ];
  const visibleProjectResourceCounts = projectResourceCounts.filter(([, count]) => count > 0);

  return (
    <section
      className="shadcn-prototype-card shadcn-prototype-chat"
      aria-label="Content generation conversation"
      onDragOver={(event) => {
        if (canUpload) {
          event.preventDefault();
          setIsDraggingUpload(true);
        }
      }}
      onDragLeave={() => setIsDraggingUpload(false)}
      onDrop={handleDrop}
    >
      <header className="shadcn-prototype-chat-head">
        <strong title={selectedConversation.title}>{selectedConversation.title}</strong>
        {diagnosticsSlot ? <div className="shadcn-prototype-chat-head-actions">{diagnosticsSlot}</div> : null}
      </header>
      {visibleProjectResourceCounts.length || onOpenProjectResources ? (
        <button
          type="button"
          className="shadcn-prototype-project-resources"
          aria-label="项目资源"
          onClick={onOpenProjectResources}
        >
          <span>项目资源</span>
          {visibleProjectResourceCounts.map(([label, count]) => (
            <em key={label}>{label} {count}</em>
          ))}
        </button>
      ) : null}
      {selectedConversation.agentTasks ? (
        <AgentTaskStrip
          tasks={selectedConversation.agentTasks}
          disabled={!canSend || sending}
          onResume={(goal) => void sendInstruction(`继续“${goal}”`)}
        />
      ) : null}
      <div className="shadcn-prototype-thread">
        {selectedConversation.detailsLoaded === false ? (
          detailLoadError ? (
            <div className="shadcn-prototype-message-group" role="alert">
              <article className="assistant">
                <p>
                  对话内容加载失败。
                  <button type="button" onClick={onRetryDetail}>重试加载</button>
                </p>
              </article>
            </div>
          ) : <ConversationDetailSkeleton />
        ) : visibleConversationMessages.map((message, index) => {
          // Resolve once so layout and rendering agree on whether this message
          // owns a workflow card. Real job steps still take precedence over the
          // optimistic skeleton inside resolveExecutionTimelineSteps.
          const liveRunState = message.assetId
            ? liveRunStateByAssetId?.[message.assetId]
            : undefined;
          const liveAgentAction = message.agentAction
            ? liveAgentActionsById?.[message.agentAction.id] ?? message.agentAction
            : undefined;
          const executionTimelineSteps = resolveExecutionTimelineSteps(liveRunState, message.runSteps);
          const timelineSteps = resolveAgentActionTimelineSteps(
            liveAgentAction,
            executionTimelineSteps,
          );
          const messageGenerationJob = generationJobFromMessage(message);
          const renderedGenerationJob = messageGenerationJob && liveGenerationJobsById.has(messageGenerationJob.id)
            ? liveGenerationJobsById.get(messageGenerationJob.id) ?? messageGenerationJob
            : messageGenerationJob;
          const directorScriptUsedForVideoProject = renderedGenerationJob
            && renderedGenerationJob.status === "completed"
            && hasReadyVideoProjectForDirectorScript(products, message.assetId);
          const agentActionFailed = liveAgentAction
            && ["failed", "blocked", "canceled"].includes(liveAgentAction.status);
          const ownsWorkflowCard = Boolean(
            message.plan || timelineSteps.length || renderedGenerationJob,
          );
          const showsAssistantWaiting = message.role === "assistant"
            && message.pending === true
            && !ownsWorkflowCard
            && !message.text.trim();
          const creativeDraft = creativeDraftPresentation(message);
          return (
            <div
              className="shadcn-prototype-message-group"
              key={conversationMessageKey(message, index)}
            >
              <article className={[
                message.suggestions?.length || message.suggestionActions?.length ? `${message.role} delivery` : message.role,
                ownsWorkflowCard ? "shadcn-prototype-workflow-card-message" : "",
                message.pending ? "pending" : "",
                message.localState ? `local-${message.localState}` : ""
              ].filter(Boolean).join(" ")}>
              {showsAssistantWaiting ? (
                <AssistantReplyPending />
              ) : shouldRenderMessageBody(message) && (!renderedGenerationJob || renderedGenerationJob.status === "completed") ? (
                <p>{message.text}</p>
              ) : null}
              {creativeDraft ? (
                <div className="shadcn-prototype-confirm-card" aria-label="创意草稿状态">
                  <div className="shadcn-prototype-confirm-head">
                    <span className="shadcn-prototype-confirm-title">{creativeDraft.title}</span>
                    <span className="shadcn-prototype-confirm-badge">
                      <span className="shadcn-prototype-confirm-dot" aria-hidden="true" />
                      待补信息
                    </span>
                  </div>
                  <p className="shadcn-prototype-confirm-sub">{creativeDraft.message}</p>
                  <p className="shadcn-prototype-confirm-sub">
                    待补：{creativeDraft.missingItems.map((item, itemIndex) => (
                      <span key={item}>{itemIndex ? "、" : ""}<span>{item}</span></span>
                    ))}
                  </p>
                  <p className="shadcn-prototype-confirm-sub">{creativeDraft.releaseNote}</p>
                </div>
              ) : null}
              {message.plan ? (
                <ConfirmCard
                  plan={message.plan}
                  assetId={message.assetId ?? undefined}
                  loadBgmCatalog={onLoadBgmCatalog}
                  optimisticallyConfirmed={
                    confirmingPlanKey === confirmationPlanKey(message.plan)
                    || (
                      optimisticExchange?.status === "pending"
                      && optimisticExchange.confirmationPlanKey === confirmationPlanKey(message.plan)
                    )
                  }
                  disabled={
                    sending
                    || !canSend
                    || (
                      VIDEO_WRITES_PAUSED
                      && ["video_parameter_confirmation", "video_project_confirmation"].includes(
                        message.plan.kind ?? "",
                      )
                    )
                  }
                  maintenanceMessage={
                    VIDEO_WRITES_PAUSED
                    && ["video_parameter_confirmation", "video_project_confirmation"].includes(
                      message.plan.kind ?? "",
                    )
                      ? VIDEO_WRITES_PAUSED_MESSAGE
                      : undefined
                  }
                  onConfirm={(plan, values) => void handleConfirmPlan(plan, values, message.assetId ?? undefined)}
                  onAdjust={(plan) => handleAdjustPlan(plan, message.assetId ?? undefined)}
                />
              ) : null}
              {timelineSteps.length ? (
                <AgentRunTimeline
                  steps={timelineSteps}
                  errorMessage={agentActionFailed
                    ? liveAgentAction.message
                    : liveRunState?.errorMessage}
                  completionConfirmed={liveAgentAction
                    ? ["succeeded", "failed", "blocked", "canceled"].includes(liveAgentAction.status)
                    : liveRunState?.completionConfirmed}
                  onRetry={
                    !writeCapabilities.canGenerate
                      ? undefined
                      : liveAgentAction?.retryable && onRetryAgentAction
                        ? (actionRunId) => void onRetryAgentAction(actionRunId)
                        : liveRunState && onRetryExecution
                          ? (retryJobId) => {
                              void onRetryExecution(retryJobId, liveRunState.jobId);
                            }
                          : undefined
                  }
                />
              ) : null}
              {renderedGenerationJob ? (
                <AssetGenerationJobCard
                  job={renderedGenerationJob}
                  onRetry={writeCapabilities.canGenerate ? onRetryGeneration : undefined}
                  onCancel={onCancelGeneration}
                  completionLabel={directorScriptUsedForVideoProject
                    ? "编导稿已确认，已用于生成视频工程"
                    : undefined}
                />
              ) : null}
              {renderProductCards(index)}
              {(() => {
                const suggestions = (message.plan?.status === "confirmed" ? [] : visibleSuggestions(message))
                  .map((suggestion) => ({ suggestion, intent: resolveSuggestionClickIntent(suggestion) }))
                  .filter(({ intent }) => {
                    if (intent.hidden) return false;
                    const normalizedUtterance = intent.utterance.replace(/\s+/g, "");
                    const isUnboundGenericConfirmation = intent.mode === "submit_message"
                      && ["确认", "确认生成"].includes(normalizedUtterance);
                    return !hasPendingPresenterCleanupConfirmation || !isUnboundGenericConfirmation;
                  });
                return suggestions.length ? (
                  <div className="shadcn-prototype-suggestion-row" aria-label="推荐调整指令">
                    {suggestions.map(({ suggestion, intent }) => {
                    const panelProducts = productCardsByMessageIndex.get(index) ?? [];
                    const panelProduct = panelProducts.find((product) => product.backendAssetId === message.assetId)
                      ?? panelProducts[0]
                      ?? products.find((product) => product.backendAssetId === message.assetId);
                    const disabled = intent.disabled
                      || (intent.mode === "open_panel" ? !panelProduct : !canSend)
                      || (sending && intent.mode === "submit_message");
                    return (
                      <button
                        type="button"
                        key={suggestion.key}
                        className={suggestion.isAiPrimary ? "shadcn-prototype-suggestion-primary" : undefined}
                        disabled={disabled}
                        title={suggestion.disabledReason}
                        onClick={() => {
                          if (disabled) return;
                          if (intent.mode === "open_panel") {
                            if (panelProduct) {
                              setComposerValue("");
                              onSelectProduct(selectedConversation.id, panelProduct.id);
                            }
                            return;
                          }
                          if (intent.mode === "submit_message") {
                            void sendInstruction(intent.utterance);
                            return;
                          }
                          if (panelProduct) {
                            // A fill-only suggestion such as “调整分镜” is
                            // attached to a specific draft card. Keep that
                            // target selected so the later composer submission
                            // carries its backend asset ID instead of whichever
                            // unrelated product was previously active.
                            onSelectProduct(selectedConversation.id, panelProduct.id);
                          }
                          setComposerValue(intent.utterance);
                          requestAnimationFrame(() => {
                            composerRef.current?.focus();
                            if (composerRef.current) {
                              resizeComposer(composerRef.current);
                            }
                          });
                        }}
                      >
                        {suggestion.label}
                      </button>
                    );
                    })}
                  </div>
                ) : null;
              })()}
              </article>
            </div>
          );
        })}
        {liveGenerationJobs
          .filter((job) => !anchoredGenerationJobIds.has(job.id) && !supersededGenerationJobIds.has(job.id))
          .map((job) => (
            <AssetGenerationJobCard
              key={job.id}
              job={job}
              onRetry={writeCapabilities.canGenerate ? onRetryGeneration : undefined}
              onCancel={onCancelGeneration}
            />
          ))}
      </div>

      <form className={canSend ? "shadcn-prototype-composer" : "shadcn-prototype-composer readonly"} onSubmit={handleSubmit}>
        <div className={composerControlClassName}>
          {imageAttachments.length ? (
            <div className="shadcn-prototype-chat-attachment-tray" aria-label="本次上传资料">
              {imageAttachments.map((attachment) => (
                <article key={attachment.id} className={attachment.status}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic blob:/remote thumbnail URLs are unsupported by next/image */}
                  {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" loading="lazy" /> : <span className="shadcn-prototype-chat-attachment-fallback"><FileText size={14} aria-hidden="true" /></span>}
                  <div>
                    <strong title={attachment.title || attachment.fileName}>{attachment.title || attachment.fileName}</strong>
                    <em aria-live="polite">{chatAttachmentStatusLabel(attachment)}</em>
                    {attachment.status === "uploading" ? (
                      <span
                        className={typeof attachment.uploadProgress === "number" ? "shadcn-prototype-chat-upload-progress" : "shadcn-prototype-chat-upload-progress indeterminate"}
                        role="progressbar"
                        aria-label={`${attachment.fileName} 上传进度`}
                        {...(typeof attachment.uploadProgress === "number"
                          ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": attachment.uploadProgress }
                          : {})}
                      >
                        <span style={typeof attachment.uploadProgress === "number" ? { width: `${attachment.uploadProgress}%` } : undefined} />
                      </span>
                    ) : null}
                  </div>
                  {attachment.status === "failed" ? (
                    <button type="button" disabled={!canUpload} onClick={() => onRetryImageAttachment?.(attachment.id)}>重试</button>
                  ) : null}
                  <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => onRemoveImageAttachment?.(attachment.id)}>×</button>
                </article>
              ))}
            </div>
          ) : null}
          {isDraggingUpload ? <div className="shadcn-prototype-chat-drop-hint">释放以上传 PDF / 图片 / 视频素材</div> : null}
          {hasReadyVideoAttachment ? <LongFormComposerPrompt onFill={(value) => {
            setComposerValue(value);
            setAdjustHint(false);
            requestAnimationFrame(() => composerRef.current?.focus());
          }} /> : null}
          <input
            ref={imageInputRef}
            type="file"
            accept={CHAT_IMAGE_UPLOAD_ACCEPT}
            multiple
            hidden
            disabled={!canUpload}
            onChange={handleImageInputChange}
          />
          <button
            className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-image-attachment-button"
            type="button"
            aria-label="上传图片素材"
            title="上传图片素材"
            disabled={!canUpload}
            aria-describedby={runtimeWriteStatusId}
            onClick={() => {
              if (canUpload) imageInputRef.current?.click();
            }}
          >
            <ImageIcon size={16} aria-hidden="true" />
          </button>
          <input
            ref={videoInputRef}
            type="file"
            accept={CHAT_VIDEO_UPLOAD_ACCEPT}
            hidden
            disabled={!canUpload}
            onChange={handleVideoInputChange}
          />
          <button
            className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-video-attachment-button"
            type="button"
            aria-label="上传视频素材"
            title="上传视频素材"
            disabled={!canUpload}
            aria-describedby={runtimeWriteStatusId}
            onClick={() => {
              if (canUpload) videoInputRef.current?.click();
            }}
          >
            <Video size={16} aria-hidden="true" />
          </button>
          <input
            ref={sourceInputRef}
            type="file"
            accept={CHAT_SOURCE_UPLOAD_ACCEPT}
            multiple
            hidden
            disabled={!canUpload}
            onChange={handleSourceInputChange}
          />
          <button
            className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-file-attachment-button"
            type="button"
            aria-label="上传 PDF 或文档"
            title="上传 PDF 或文档"
            disabled={!canUpload}
            aria-describedby={runtimeWriteStatusId}
            onClick={() => {
              if (canUpload) sourceInputRef.current?.click();
            }}
          >
            <FileText size={15} aria-hidden="true" />
          </button>
          <textarea
            className="shadcn-prototype-composer-textarea"
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder={
              readonly
                ? "参考样例只读"
                : !writeCapabilities.canGenerate
                  ? "后端暂时不可用，暂不能创作"
                : adjustHint
                  ? ADJUST_HINT_PLACEHOLDER
                  : selectedProduct && ["video", "mg-overlay"].includes(selectedProduct.mode)
                    ? "说说想改哪段，比如「第 2 段字卡换成保修年限」…"
                    : "随时打断或补充，AI 会接着改…"
            }
            rows={1}
            value={composerValue}
            disabled={!canSend}
            aria-describedby={runtimeWriteStatusId}
            onChange={(event) => {
              setComposerValue(event.currentTarget.value);
              if (adjustHint) setAdjustHint(false);
            }}
            onPaste={(event) => {
              const sourceUrl = supportedLongFormUrlFromText(event.clipboardData.getData("text"));
              if (!sourceUrl || !canUpload || !onImportVideoUrl) return;
              event.preventDefault();
              setSendError(null);
              onImportVideoUrl(sourceUrl);
            }}
            onInput={(event) => {
              resizeComposer(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (shouldSubmitComposerOnEnter(event)) {
                event.preventDefault();
                void submitInstruction();
              }
            }}
          />
          <button
            className={sending ? "primary stop" : "primary"}
            type={sending ? "button" : "submit"}
            aria-label={sending ? "停止生成" : "发送"}
            title={sending ? "停止生成" : "发送"}
            disabled={!canSend && !sending}
            aria-describedby={runtimeWriteStatusId}
            onClick={sending ? stopGeneration : undefined}
          >
            {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
          </button>
        </div>
        {imageAttachments.length ? <p className="shadcn-prototype-chat-attachment-help">{ATTACHMENT_HELP_TEXT}</p> : null}
        <p
          className="shadcn-prototype-composer-error"
          data-testid="conversation-studio-error-announcer"
          role={sendError && optimisticExchange?.presentation !== "execution_anchor" ? "alert" : undefined}
          aria-live="assertive"
          aria-atomic="true"
          style={sendError && optimisticExchange?.presentation !== "execution_anchor" ? undefined : { margin: 0 }}
        >
          {sendError && optimisticExchange?.presentation !== "execution_anchor" ? (
            <span key={sendErrorNotice.revision}>{sendError}</span>
          ) : null}
        </p>
        {writeCapabilities.reason ? (
          <p
            id={runtimeWriteStatusId}
            className="shadcn-prototype-composer-error"
            role="status"
          >
            {writeCapabilities.reason}
            {writeCapabilities.recovery === "retry" && onRetryWriteAvailability ? (
              <button type="button" onClick={onRetryWriteAvailability}>重新连接</button>
            ) : null}
          </p>
        ) : null}
      </form>
    </section>
  );
}
