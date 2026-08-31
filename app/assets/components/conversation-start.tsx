"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { ArrowUp, ExternalLink, FileText, Image as ImageIcon, Sparkles, Square, Video } from "lucide-react";
import { attachmentSendBlockReason, chatAttachmentStatusLabel, shouldSubmitComposerOnEnter, type Conversation } from "../lib/asset-workspace-shared";
import {
  CHAT_IMAGE_UPLOAD_ACCEPT,
  CHAT_SOURCE_UPLOAD_ACCEPT,
  CHAT_VIDEO_UPLOAD_ACCEPT,
  chatAttachmentRejectionMessage,
  partitionChatAttachmentFiles,
} from "../lib/chat-attachment-policy";
import { supportedLongFormUrlFromText } from "../lib/long-form-composer-source";
import { formatComposerError } from "../../../lib/api";
import type { ChatImageAttachment } from "./conversation-studio";
import MaterialsReadyStrip from "./materials-ready-strip";
import LongFormComposerPrompt from "./long-form-composer-prompt";
import {
  DEFAULT_RUNTIME_WRITE_CAPABILITIES,
  type RuntimeWriteCapabilities,
} from "../lib/runtime-write-capabilities";
import {
  getProductAnalyticsSessionId,
  trackProductEvent,
} from "../../../lib/product-analytics";

const IMAGE_ONLY_INSTRUCTION = "请先总结这些图片素材，并询问我想做视频、文案还是封面。";
const DOC_ONLY_INSTRUCTION = "请先阅读这些资料，并询问我想基于它做视频、文案还是总结。";
const ATTACHMENT_HELP_TEXT = "图片会作为画面素材，PDF/文档会作为内容依据；添加视频后请先说明想怎么处理。";

// Demo-final suggestion cards carry a hint line and a richer fill utterance;
// unknown labels degrade to a title-only card (no invented copy).
const SUGGESTION_PRESETS: Record<string, { hint?: string; fill?: string }> = {
  "用已有素材生成短视频": { hint: "AI 自动编导并匹配画面", fill: "用我已有的素材生成一条可编辑的短视频" },
  "用图片和视频做成片": { hint: "优先使用你的真实素材", fill: "用我已有的图片和视频生成一条 9:16 的 30 秒短视频" },
  "把文档做成短视频": { hint: "关键内容保留来源", fill: "把我上传的文档做成一条可编辑的短视频，关键内容保留来源" },
  "继续修改已有视频": { hint: "换画面、改文案或调整分镜", fill: "继续修改我已有的视频，先让我选择要修改的版本" }
};
const SUGGESTION_EVENT_KEYS: Record<string, string> = {
  "用已有素材生成短视频": "saved-assets-video",
  "用图片和视频做成片": "images-and-video",
  "把文档做成短视频": "document-to-video",
  "继续修改已有视频": "continue-editing-video",
};

function suggestionIcon(label: string): ReactNode {
  if (/视频|口播/.test(label)) return <Video size={15} aria-hidden="true" />;
  if (/种草|好评|分享/.test(label)) return <ExternalLink size={15} aria-hidden="true" />;
  if (/图|封面/.test(label)) return <ImageIcon size={15} aria-hidden="true" />;
  if (/文案|帖|资料|稿/.test(label)) return <FileText size={15} aria-hidden="true" />;
  return <Sparkles size={15} aria-hidden="true" />;
}

function greetingLabel(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default function ConversationStart({
  suggestions,
  onSend,
  conversation,
  accountName,
  imageAttachments = [],
  onUploadImages,
  onRemoveImageAttachment,
  onRetryImageAttachment,
  onImportVideoUrl,
  token,
  onOpenImageLibrary,
  writeCapabilities = DEFAULT_RUNTIME_WRITE_CAPABILITIES,
  onRetryWriteAvailability,
}: {
  suggestions: string[];
  onSend?: (conversation: Conversation, instruction: string, signal?: AbortSignal) => Promise<void>;
  conversation: Conversation;
  accountName?: string;
  imageAttachments?: ChatImageAttachment[];
  onUploadImages?: (files: File[]) => void;
  onRemoveImageAttachment?: (attachmentId: string) => void;
  onRetryImageAttachment?: (attachmentId: string) => void;
  onImportVideoUrl?: (url: string) => void;
  token?: string | null;
  onOpenImageLibrary?: () => void;
  writeCapabilities?: RuntimeWriteCapabilities;
  onRetryWriteAvailability?: () => void;
}) {
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [errorNotice, setErrorNotice] = useState<{ message: string | null; revision: number }>({
    message: null,
    revision: 0,
  });
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const hasReadyImageAttachment = imageAttachments.some((attachment) => attachment.fileKind === "image" && attachment.status === "ready" && attachment.assetId);
  const hasReadySourceAttachment = imageAttachments.some((attachment) => attachment.fileKind === "source" && attachment.status === "ready" && attachment.assetId);
  const hasReadyVideoAttachment = imageAttachments.some((attachment) => attachment.fileKind === "video" && attachment.status === "ready" && attachment.assetId);
  const canUpload = Boolean(onUploadImages) && writeCapabilities.canUpload;
  const canGenerate = Boolean(onSend) && writeCapabilities.canGenerate;
  const runtimeWriteStatusId = writeCapabilities.reason
    ? "multimix-start-runtime-write-status"
    : undefined;
  const setError = (message: string | null) => {
    setErrorNotice((current) => ({
      message,
      revision: message ? current.revision + 1 : current.revision,
    }));
  };

  const resizeComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "52px";
    textarea.style.height = `${Math.max(52, textarea.scrollHeight)}px`;
  };

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  useEffect(() => {
    void trackProductEvent(token, {
      eventName: "workspace_opened",
      sessionId: getProductAnalyticsSessionId(),
      properties: { entry_surface: "new_conversation" },
    });
  }, [token]);

  const submit = async () => {
    const blockReason = attachmentSendBlockReason(imageAttachments);
    if (blockReason) {
      setError(blockReason);
      return;
    }
    const explicitInstruction = composerValue.trim();
    if (hasReadyVideoAttachment && !explicitInstruction) {
      setError("请先说明你想怎么处理这段内容。");
      return;
    }
    const instruction = explicitInstruction || (hasReadyImageAttachment ? IMAGE_ONLY_INSTRUCTION : hasReadySourceAttachment ? DOC_ONLY_INSTRUCTION : "");
    if ((!instruction && !hasReadyImageAttachment && !hasReadySourceAttachment) || !canGenerate || !onSend || sending) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setSending(true);
    setError(null);
    setComposerValue("");
    try {
      await onSend(conversation, instruction, controller.signal);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      setError(formatComposerError(e));
    } finally {
      controllerRef.current = null;
      setSending(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSending(false);
  };

  const handleAttachmentFiles = (files: FileList | File[]) => {
    if (!canUpload) return;
    const partition = partitionChatAttachmentFiles(files);
    setError(chatAttachmentRejectionMessage(partition));
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

  const dockClassName = [
    "shadcn-prototype-start-dock",
    imageAttachments.length ? "has-attachments" : "",
    isDraggingUpload ? "drag-active" : ""
  ].filter(Boolean).join(" ");

  const fillComposer = (value: string) => {
    setComposerValue(value);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      if (composerRef.current) {
        resizeComposer(composerRef.current);
      }
    });
  };

  return (
    <section
      className="shadcn-prototype-start"
      aria-label="新建对话"
      onDragOver={(event) => {
        if (canUpload) {
          event.preventDefault();
          setIsDraggingUpload(true);
        }
      }}
      onDragLeave={() => setIsDraggingUpload(false)}
      onDrop={handleDrop}
    >
      <div className="shadcn-prototype-start-inner">
        <p className="shadcn-prototype-start-greet">{greetingLabel()}{accountName ? `，${accountName}` : ""}</p>
        <h1>今天想做什么短视频？</h1>
        <p className="shadcn-prototype-start-sub">上传素材，说出需求，生成可编辑的短视频</p>
        <div className={dockClassName}>
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
                  {attachment.status === "failed" ? <button type="button" disabled={!canUpload} onClick={() => onRetryImageAttachment?.(attachment.id)}>重试</button> : null}
                  <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => onRemoveImageAttachment?.(attachment.id)}>×</button>
                </article>
              ))}
            </div>
          ) : null}
          {isDraggingUpload ? <div className="shadcn-prototype-chat-drop-hint">释放以上传 PDF / 图片 / 视频素材</div> : null}
          {hasReadyVideoAttachment ? <LongFormComposerPrompt onFill={fillComposer} /> : null}
          <textarea
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder="例如：用我上周的安装素材，做一条 30 秒竖屏短视频…"
            rows={1}
            value={composerValue}
            disabled={!canGenerate}
            aria-describedby={runtimeWriteStatusId}
            onChange={(event) => setComposerValue(event.currentTarget.value)}
            onPaste={(event) => {
              const sourceUrl = supportedLongFormUrlFromText(event.clipboardData.getData("text"));
              if (!sourceUrl || !canUpload || !onImportVideoUrl) return;
              event.preventDefault();
              setError(null);
              onImportVideoUrl(sourceUrl);
            }}
            onInput={(event) => resizeComposer(event.currentTarget)}
            onKeyDown={(event) => {
              if (shouldSubmitComposerOnEnter(event)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="shadcn-prototype-start-dock-bar">
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
              className="shadcn-prototype-start-dock-attach"
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
              className="shadcn-prototype-start-dock-attach"
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
              className="shadcn-prototype-start-dock-attach"
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
            <span className="shadcn-prototype-start-dock-hint">支持拖入 PDF / 图片 / 视频，也可粘贴视频链接</span>
            <button
              className={sending ? "shadcn-prototype-start-dock-send stop" : "shadcn-prototype-start-dock-send"}
              type="button"
              aria-label={sending ? "停止" : "发送"}
              disabled={!canGenerate && !sending}
              aria-describedby={runtimeWriteStatusId}
              onClick={sending ? stop : () => void submit()}
            >
              {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
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
        {imageAttachments.length ? <p className="shadcn-prototype-chat-attachment-help">{ATTACHMENT_HELP_TEXT}</p> : null}
        <p
          className="shadcn-prototype-composer-error"
          data-testid="conversation-start-error-announcer"
          role={errorNotice.message ? "alert" : undefined}
          aria-live="assertive"
          aria-atomic="true"
          style={errorNotice.message ? undefined : { margin: 0 }}
        >
          {errorNotice.message ? <span key={errorNotice.revision}>{errorNotice.message}</span> : null}
        </p>
        {suggestions.length > 0 ? (
          <div className="shadcn-prototype-start-sugg-grid" aria-label="推荐指令">
            {suggestions.map((suggestion, index) => {
              const preset = SUGGESTION_PRESETS[suggestion];
              return (
                <button
                  type="button"
                  className="shadcn-prototype-start-sugg-card"
                  key={suggestion}
                  disabled={sending}
                  onClick={() => {
                    void trackProductEvent(token, {
                      eventName: "recommendation_selected",
                      properties: {
                        recommendation_key: SUGGESTION_EVENT_KEYS[suggestion]
                          ?? `recommendation-${index + 1}`,
                      },
                    });
                    fillComposer(preset?.fill ?? suggestion);
                  }}
                >
                  <span className="ic">{suggestionIcon(suggestion)}</span>
                  <span className="tx">
                    <span className="t">{suggestion}</span>
                    {preset?.hint ? <span className="s">{preset.hint}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <MaterialsReadyStrip token={token} onOpenImageLibrary={onOpenImageLibrary} />
      </div>
    </section>
  );
}
