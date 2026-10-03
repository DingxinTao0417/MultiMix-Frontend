"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Square, Video } from "lucide-react";
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
import HomepageShowcase from "./homepage-showcase";
import styles from "./creative-memory-ui.module.css";
import {
  DEFAULT_RUNTIME_WRITE_CAPABILITIES,
  type RuntimeWriteCapabilities,
} from "../lib/runtime-write-capabilities";
import {
  getProductAnalyticsSessionId,
  trackProductEvent,
} from "../../../lib/product-analytics";

const IMAGE_ONLY_INSTRUCTION = "请先理解并概括这些图片，等待我说明创作目标；本次仅上传素材，不开始制作。";
const DOC_ONLY_INSTRUCTION = "请先阅读并概括这些资料，等待我说明创作目标；本次仅上传资料，不开始制作。";
const VIDEO_ONLY_INSTRUCTION = "我上传了一条视频，请先询问我是否识别并拆分分镜，暂不开始处理。";
const ATTACHMENT_HELP_TEXT = "图片和视频会作为创作素材，PDF/文档会作为内容依据；视频也可以作为需要优化的口播原片。";

const START_CAPABILITIES = [
  "我的素材",
  "AI 生成镜头",
  "公开素材",
  "字幕、图文与图形动画",
  "原片优化、配音与音乐",
] as const;

const START_PATHS = [
  {
    key: "start-idea",
    title: "从想法开始",
    hint: "说出目标，一起确定内容和画面。",
    imageClass: "goal-idea",
    fill: "我想做一条新视频，先从想法开始。请先帮我明确目标，再和我讨论内容、画面，以及需要哪些素材。",
  },
  {
    key: "start-material",
    title: "用素材创作",
    hint: "上传照片、人物、资料或参考片，制作新作品。",
    imageClass: "goal-material",
    fill: "我想用素材或参考片制作一条新视频。请先问我会提供哪些照片、人物、资料或参考片，确认各自的用途，再讨论内容和画面方案。",
  },
  {
    key: "start-edit",
    title: "修改现有视频",
    hint: "上传原片，说明要保留和调整的部分。",
    imageClass: "goal-edit",
    fill: "我想修改一条现有视频。请先让我提供原片，并确认要保留什么、调整什么，再讨论修改方案。",
  },
] as const;

function greetingLabel(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default function ConversationStart({
  navigationSlot,
  onSend,
  conversation,
  accountName,
  imageAttachments = [],
  onUploadImages,
  onRemoveImageAttachment,
  onRetryImageAttachment,
  onImportVideoUrl,
  token,
  creativeProfileVisible = false,
  ignoreProfile = false,
  onIgnoreProfileChange,
  writeCapabilities = DEFAULT_RUNTIME_WRITE_CAPABILITIES,
  onRetryWriteAvailability,
}: {
  navigationSlot?: ReactNode;
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
  creativeProfileVisible?: boolean;
  ignoreProfile?: boolean;
  onIgnoreProfileChange?: (ignore: boolean) => void;
  writeCapabilities?: RuntimeWriteCapabilities;
  onRetryWriteAvailability?: () => void;
}) {
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);
  const [showGoalExplanation, setShowGoalExplanation] = useState(false);
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
    textarea.style.height = "42px";
    textarea.style.height = `${Math.max(42, textarea.scrollHeight)}px`;
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
    const instruction = explicitInstruction || (hasReadyImageAttachment
      ? IMAGE_ONLY_INSTRUCTION
      : hasReadySourceAttachment
        ? DOC_ONLY_INSTRUCTION
        : hasReadyVideoAttachment
          ? VIDEO_ONLY_INSTRUCTION
          : "");
    if ((!instruction && !hasReadyImageAttachment && !hasReadySourceAttachment && !hasReadyVideoAttachment) || !canGenerate || !onSend || sending) return;
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

  const selectStarter = (
    key: string,
    fill: string,
  ) => {
    setSelectedStarter(key);
    void trackProductEvent(token, {
      eventName: "recommendation_selected",
      properties: { recommendation_key: key },
    });
    fillComposer(fill);
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
      {navigationSlot ? <div className="shadcn-prototype-start-navigation">{navigationSlot}</div> : null}
      <div className="shadcn-prototype-start-inner">
        <p className="shadcn-prototype-start-greet">{greetingLabel()}{accountName ? `，${accountName}` : ""}</p>
        <h1>新建视频项目</h1>
        <p className="shadcn-prototype-start-sub">说出想法，让 AI 帮你更快、更省力地做出短视频。</p>
        {creativeProfileVisible && token && onIgnoreProfileChange ? (
          <label className={styles.startOptOut}>
            <input className={styles.startCheckbox} type="checkbox" checked={ignoreProfile} onChange={(event) => onIgnoreProfileChange(event.target.checked)} />
            本项目不使用创作档案
          </label>
        ) : null}
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
          <textarea
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder="例如：我想给新开的咖啡店做一条短视频，吸引附近的人来看看…"
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
        <section className="shadcn-prototype-start-capabilities" aria-label="可组合的视频制作能力">
          <span className="shadcn-prototype-start-capability-label">可组合能力</span>
          <span className="shadcn-prototype-start-capability-list">
            {START_CAPABILITIES.map((capability) => (
              <span className="shadcn-prototype-start-capability" key={capability}>
                <i aria-hidden="true" />{capability}
              </span>
            ))}
          </span>
          <button
            className="shadcn-prototype-start-capability-help"
            type="button"
            aria-expanded={showGoalExplanation}
            onClick={() => setShowGoalExplanation((current) => !current)}
          >
            这些会限制制作方式吗？
          </button>
        </section>
        {showGoalExplanation ? (
          <p className="shadcn-prototype-start-goal-explanation" role="status">
            入口只会填入一段可编辑的需求，不会锁定视频类型、模型或制作工具。
          </p>
        ) : null}
        <section className="shadcn-prototype-start-starter-section" aria-labelledby="conversation-start-paths">
          <div className="shadcn-prototype-start-section-head">
            <h2 id="conversation-start-paths">你想怎么开始？</h2>
          </div>
          <div className="shadcn-prototype-start-goal-grid">
            {START_PATHS.map((path) => (
              <button
                type="button"
                key={path.key}
                data-testid="conversation-start-goal"
                className={`shadcn-prototype-start-goal-card ${path.imageClass}${selectedStarter === path.key ? " selected" : ""}`}
                aria-pressed={selectedStarter === path.key}
                disabled={sending}
                onClick={() => selectStarter(path.key, path.fill)}
              >
                <span>
                  <strong>{path.title}</strong>
                  <small>{path.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <HomepageShowcase />
      </div>
    </section>
  );
}
