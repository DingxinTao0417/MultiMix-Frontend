"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Play, Square, Video } from "lucide-react";
import { attachmentSendBlockReason, chatAttachmentStatusLabel, getConversationProducts, type ChatAttachmentFileKind, type ChatAttachmentStatus, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import {
  CHAT_IMAGE_UPLOAD_ACCEPT,
  CHAT_SOURCE_UPLOAD_ACCEPT,
  chatAttachmentRejectionMessage,
  partitionChatAttachmentFiles,
} from "../lib/chat-attachment-policy";
import { mergeVisibleConversationMessages, optimisticVideoProjectSteps, shouldRenderMessageBody } from "../lib/conversation-execution-presentation";
import { resolveSuggestionClickIntent } from "../lib/suggestion-actions";
import { formatComposerError, MESSAGE_NOT_SUBMITTED_ERROR, type AssetGenerationJobResponse } from "../../../lib/api";
import type {
  AgentActionRunResponse,
  AgentRunStep,
  AssetConversationMessage,
  AssetMessagePlan,
  AssetMessagePresentation,
  AssetPlanConfirmationValues,
  AssetVideoParameterConfirmation,
} from "../lib/asset-workspace-types";
import ConfirmCard from "./confirm-card";
import AgentRunTimeline from "./agent-run-timeline";
import AgentTaskStrip from "./agent-task-strip";
import { AssistantReplyPending, ConversationDetailSkeleton } from "./conversation-waiting-state";
import { AssetGenerationJobCard } from "./asset-generation-job-card";

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

const IMAGE_ONLY_INSTRUCTION = "请先总结这些图片素材，并询问我想做视频、文案还是封面。";
const DOC_ONLY_INSTRUCTION = "请先阅读这些资料，并询问我想基于它做视频、文案还是总结。";
const ATTACHMENT_HELP_TEXT = "只上传资料时，我会先询问要基于它做什么；图片会作为素材，PDF/文档会作为来源资产。";
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
    stage: typeof metadata.asset_generation_stage === "string" ? metadata.asset_generation_stage : String(status),
    attempts: 0,
    result_asset_id: typeof metadata.product_id === "number" ? metadata.product_id : null,
    error_code: typeof metadata.asset_generation_error_code === "string" ? metadata.asset_generation_error_code : null,
    error_message: status === "failed" || status === "cancelled" ? message.text : null,
    created_at: "",
    updated_at: "",
    started_at: typeof metadata.asset_generation_started_at === "string" ? metadata.asset_generation_started_at : null,
    progress_events: progress,
  };
}

function confirmationPlanKey(plan: AssetMessagePlan): string {
  return [
    plan.confirmationId ?? "",
    plan.title,
    plan.confirmUtterance ?? plan.confirmLabel ?? "",
    plan.fields.map((field) => field.key + ":" + field.value).join("|"),
  ].join("::");
}

function fallbackProductMessageIndex(messages: VisibleConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.pending && !message.suggestions?.length && !message.suggestionActions?.length) return index;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.pending) return index;
  }
  return -1;
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

function mapProductsToConversationMessages(messages: VisibleConversationMessage[], products: ProductArtifact[]): Map<number, ProductArtifact[]> {
  const result = new Map<number, ProductArtifact[]>();
  const attachedProductIds = new Set<string>();

  messages.forEach((message, index) => {
    if (message.role !== "assistant" || !message.assetId) return;
    const matchedProducts = products.filter((product) => product.backendAssetId === message.assetId);
    if (!matchedProducts.length) return;
    result.set(index, matchedProducts);
    matchedProducts.forEach((product) => attachedProductIds.add(product.id));
  });

  const unattachedProducts = products.filter((product) => !attachedProductIds.has(product.id));
  if (!unattachedProducts.length) return result;

  const fallbackIndex = fallbackProductMessageIndex(messages);
  if (fallbackIndex >= 0) {
    result.set(fallbackIndex, [...(result.get(fallbackIndex) ?? []), ...unattachedProducts]);
  }
  return result;
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
  pendingExchange = null,
  onPendingExchangeChange,
  onSendMessage,
  generationJob = null,
  onRetryGeneration,
  onCancelGeneration,
  liveRunStateByAssetId,
  onRetryExecution,
  liveAgentActionsById,
  onRetryAgentAction,
  diagnosticsSlot = null,
  detailLoadError = false,
  onRetryDetail,
  readonly = false
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
  ) => Promise<void>;
  generationJob?: AssetGenerationJobResponse | null;
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
  detailLoadError?: boolean;
  onRetryDetail?: () => void;
  readonly?: boolean;
}) {
  const products = getConversationProducts(selectedConversation);
  const [composerValue, setComposerValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
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
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const selectedConversationIdRef = useRef(selectedConversation.id);
  selectedConversationIdRef.current = selectedConversation.id;
  const hasReadyImageAttachment = imageAttachments.some((attachment) => (attachment.fileKind === "image" || attachment.fileKind === "video") && attachment.status === "ready" && attachment.assetId);
  const hasReadySourceAttachment = imageAttachments.some((attachment) => attachment.fileKind === "source" && attachment.status === "ready" && attachment.assetId);

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
  }, [selectedConversation.id]);

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
  ) => {
    const blockReason = attachmentSendBlockReason(imageAttachments);
    if (blockReason) {
      setSendError(blockReason);
      return;
    }
    if (readonly || !onSendMessage || (!instruction && !hasReadyImageAttachment && !hasReadySourceAttachment) || sending) return;
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
    const instruction = composerValue.trim() || (hasReadyImageAttachment ? IMAGE_ONLY_INSTRUCTION : hasReadySourceAttachment ? DOC_ONLY_INSTRUCTION : "");
    await sendInstruction(instruction);
  };

  const handleConfirmPlan = async (
    plan: AssetMessagePlan,
    values?: AssetPlanConfirmationValues,
  ) => {
    const base = (plan.confirmUtterance ?? plan.confirmLabel ?? "确认，开始生成").trim();
    const isVideoParameterConfirmation = plan.kind === "video_parameter_confirmation";
    const isAgentActionConfirmation = plan.kind === "agent_action_confirmation";
    const ratio = values?.ratio;
    const ratioLabel = ratio ? plan.ratioOptions?.find((option) => option.value === ratio)?.label : undefined;
    const instruction = !isVideoParameterConfirmation && ratioLabel ? `${base}（${ratioLabel}）` : base;
    const videoParameterConfirmation = (
      isVideoParameterConfirmation
      && plan.pendingIntentId
      && plan.pendingIntentVersion
      && ratio
      && values?.targetSeconds
    ) ? {
        pendingIntentId: plan.pendingIntentId,
        version: plan.pendingIntentVersion,
        ratio,
        targetSeconds: values.targetSeconds,
      } : undefined;
    if (isVideoParameterConfirmation && !videoParameterConfirmation) {
      setSendError("视频参数确认信息不完整，请刷新后重试。");
      return;
    }
    if (isAgentActionConfirmation && !plan.confirmationId) {
      setSendError("视频修改确认信息已失效，请刷新后重试。");
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
            : "已确认，正在创建视频工程任务。",
        presentation: "execution_anchor",
        runSteps: isAgentActionConfirmation
          ? [{
              key: plan.confirmationId ?? "agent-action-confirmation",
              label: "执行视频修改",
              status: "run",
            }]
          : optimisticVideoProjectSteps(),
        confirmationPlanKey: planKey,
      }, globalThis.crypto.randomUUID(), videoParameterConfirmation, plan.confirmationId);
    } finally {
      setConfirmingPlanKey((current) => current === planKey ? null : current);
    }
  };

  const handleAdjustPlan = (plan: AssetMessagePlan) => {
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
      const utterance = (event as CustomEvent<{ utterance?: string }>).detail?.utterance;
      if (typeof utterance === "string" && utterance.trim()) {
        void sendInstruction(utterance.trim());
      }
    };
    window.addEventListener("multimix:composer-focus", onFocusComposer);
    window.addEventListener("multimix:composer-send", onComposerSend);
    return () => {
      window.removeEventListener("multimix:composer-focus", onFocusComposer);
      window.removeEventListener("multimix:composer-send", onComposerSend);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversation.id, sending, readonly]);

  const handleAttachmentFiles = (files: FileList | File[]) => {
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

  const handleDrop = (event: DragEvent) => {
    if (!onUploadImages || readonly) return;
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
              ) : product.mode === "video" || product.mode === "digital-human" || product.mode === "mg_animation_video" ? (
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

  const canSend = Boolean(onSendMessage) && !readonly;
  const composerControlClassName = [
    imageAttachments.length ? "shadcn-prototype-composer-control has-attachments" : "shadcn-prototype-composer-control",
    isDraggingUpload ? "drag-active" : ""
  ].filter(Boolean).join(" ");
  const liveGenerationJobMessagePresent = Boolean(
    generationJob && visibleConversationMessages.some((message) => generationJobFromMessage(message)?.id === generationJob.id),
  );

  return (
    <section
      className="shadcn-prototype-card shadcn-prototype-chat"
      aria-label="Content generation conversation"
      onDragOver={(event) => {
        if (onUploadImages && !readonly) {
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
          const agentActionFailed = liveAgentAction
            && ["failed", "blocked", "canceled"].includes(liveAgentAction.status);
          const ownsWorkflowCard = Boolean(message.plan || timelineSteps.length);
          const messageGenerationJob = generationJobFromMessage(message);
          const renderedGenerationJob = messageGenerationJob && generationJob?.id === messageGenerationJob.id
            ? generationJob
            : messageGenerationJob;
          const showsAssistantWaiting = message.role === "assistant"
            && message.pending === true
            && !ownsWorkflowCard
            && !message.text.trim();
          return (
            <div
              className="shadcn-prototype-message-group"
              key={`${message.role}-${index}`}
            >
              <article className={[
                message.suggestions?.length || message.suggestionActions?.length ? `${message.role} delivery` : message.role,
                ownsWorkflowCard ? "shadcn-prototype-workflow-card-message" : "",
                message.pending ? "pending" : "",
                message.localState ? `local-${message.localState}` : ""
              ].filter(Boolean).join(" ")}>
              {showsAssistantWaiting ? (
                <AssistantReplyPending />
              ) : shouldRenderMessageBody(message) ? (
                <p>{message.text}</p>
              ) : null}
              {message.plan ? (
                <ConfirmCard
                  plan={message.plan}
                  optimisticallyConfirmed={
                    confirmingPlanKey === confirmationPlanKey(message.plan)
                    || (
                      optimisticExchange?.status === "pending"
                      && optimisticExchange.confirmationPlanKey === confirmationPlanKey(message.plan)
                    )
                  }
                  disabled={sending || !canSend}
                  onConfirm={(plan, values) => void handleConfirmPlan(plan, values)}
                  onAdjust={(plan) => handleAdjustPlan(plan)}
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
                    liveAgentAction?.retryable && onRetryAgentAction
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
                  onRetry={onRetryGeneration}
                  onCancel={onCancelGeneration}
                />
              ) : null}
              {(() => {
                const suggestions = visibleSuggestions(message)
                  .map((suggestion) => ({ suggestion, intent: resolveSuggestionClickIntent(suggestion) }))
                  .filter(({ intent }) => !intent.hidden);
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
              {renderProductCards(index)}
            </div>
          );
        })}
        {generationJob && !liveGenerationJobMessagePresent ? (
          <AssetGenerationJobCard
            job={generationJob}
            onRetry={onRetryGeneration}
            onCancel={onCancelGeneration}
          />
        ) : null}
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
                    <button type="button" onClick={() => onRetryImageAttachment?.(attachment.id)}>重试</button>
                  ) : null}
                  <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => onRemoveImageAttachment?.(attachment.id)}>×</button>
                </article>
              ))}
            </div>
          ) : null}
          {isDraggingUpload ? <div className="shadcn-prototype-chat-drop-hint">释放以上传 PDF / 图片素材</div> : null}
          <input
            ref={imageInputRef}
            type="file"
            accept={CHAT_IMAGE_UPLOAD_ACCEPT}
            multiple
            hidden
            onChange={handleImageInputChange}
          />
          <button
            className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-image-attachment-button"
            type="button"
            aria-label="上传图片素材"
            title="上传图片素材"
            disabled={!canSend || !onUploadImages}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImageIcon size={16} aria-hidden="true" />
          </button>
          <input
            ref={sourceInputRef}
            type="file"
            accept={CHAT_SOURCE_UPLOAD_ACCEPT}
            multiple
            hidden
            onChange={handleSourceInputChange}
          />
          <button
            className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-file-attachment-button"
            type="button"
            aria-label="上传 PDF 或文档"
            title="上传 PDF 或文档"
            disabled={!canSend || !onUploadImages}
            onClick={() => sourceInputRef.current?.click()}
          >
            <FileText size={15} aria-hidden="true" />
          </button>
          <textarea
            className="shadcn-prototype-composer-textarea"
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder={
              !canSend
                ? "参考样例只读"
                : adjustHint
                  ? ADJUST_HINT_PLACEHOLDER
                  : selectedProduct && ["video", "digital-human", "mg_animation_video"].includes(selectedProduct.mode)
                    ? "说说想改哪段，比如「第 2 段字卡换成保修年限」…"
                    : "随时打断或补充，AI 会接着改…"
            }
            rows={1}
            value={composerValue}
            disabled={!canSend}
            onChange={(event) => {
              setComposerValue(event.currentTarget.value);
              if (adjustHint) setAdjustHint(false);
            }}
            onInput={(event) => {
              resizeComposer(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
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
            onClick={sending ? stopGeneration : undefined}
          >
            {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
          </button>
        </div>
        {imageAttachments.length ? <p className="shadcn-prototype-chat-attachment-help">{ATTACHMENT_HELP_TEXT}</p> : null}
        {sendError && optimisticExchange?.presentation !== "execution_anchor" ? (
          <p className="shadcn-prototype-composer-error">{sendError}</p>
        ) : null}
      </form>
    </section>
  );
}
