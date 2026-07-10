"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { ArrowUp, ExternalLink, FileText, Image as ImageIcon, Sparkles, Square, Video } from "lucide-react";
import { attachmentSendBlockReason, type Conversation } from "../lib/asset-workspace-shared";
import { formatComposerError } from "../../../lib/api";
import type { ChatImageAttachment } from "./conversation-studio";
import MaterialsReadyStrip from "./materials-ready-strip";

const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
const SOURCE_UPLOAD_ACCEPT = ".pptx,.pdf,.docx,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm";
const IMAGE_ONLY_INSTRUCTION = "请先总结这些图片素材，并询问我想做视频、文案还是封面。";
const DOC_ONLY_INSTRUCTION = "请先阅读这些资料，并询问我想基于它做视频、文案还是总结。";
const ATTACHMENT_HELP_TEXT = "只上传资料时，我会先询问要基于它做什么；图片会作为素材，PPT/文档会作为来源资产。";

// Demo-final suggestion cards carry a hint line and a richer fill utterance;
// unknown labels degrade to a title-only card (no invented copy).
const SUGGESTION_PRESETS: Record<string, { hint?: string; fill?: string }> = {
  "写一条小红书文案": { hint: "用已解析的案例图，真实风格", fill: "写一条小红书文案，用已解析的案例图，真实风格" },
  "生成 9:16 短视频脚本": { hint: "30 秒，适配抖音和视频号", fill: "生成一条 9:16 的 30 秒短视频脚本，适配抖音和视频号" },
  "做一张封面图": { hint: "从你的完工照片里选主图", fill: "做一张封面图，从我的完工照片里选主图" },
  "把好评截图变成种草帖": { hint: "客户的话比广告更有说服力", fill: "把客户好评截图变成一条种草帖" }
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
  token,
  onOpenImageLibrary
}: {
  suggestions: string[];
  onSend?: (conversation: Conversation, instruction: string, signal?: AbortSignal) => Promise<void>;
  conversation: Conversation;
  accountName?: string;
  imageAttachments?: ChatImageAttachment[];
  onUploadImages?: (files: File[]) => void;
  onRemoveImageAttachment?: (attachmentId: string) => void;
  onRetryImageAttachment?: (attachmentId: string) => void;
  token?: string | null;
  onOpenImageLibrary?: () => void;
}) {
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const hasReadyImageAttachment = imageAttachments.some((attachment) => attachment.fileKind === "image" && attachment.status === "ready" && attachment.assetId);
  const hasReadySourceAttachment = imageAttachments.some((attachment) => attachment.fileKind === "source" && attachment.status === "ready" && attachment.assetId);

  const resizeComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "52px";
    textarea.style.height = `${Math.max(52, textarea.scrollHeight)}px`;
  };

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  const submit = async () => {
    const blockReason = attachmentSendBlockReason(imageAttachments);
    if (blockReason) {
      setError(blockReason);
      return;
    }
    const instruction = composerValue.trim() || (hasReadyImageAttachment ? IMAGE_ONLY_INSTRUCTION : hasReadySourceAttachment ? DOC_ONLY_INSTRUCTION : "");
    if ((!instruction && !hasReadyImageAttachment && !hasReadySourceAttachment) || !onSend || sending) return;
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
    const acceptedFiles = Array.from(files).filter((file) => {
      if (file.type.startsWith("image/")) return true;
      return /\.(pptx|pdf|docx|txt|md|markdown|html|htm|xlsx|xlsm)$/i.test(file.name);
    });
    if (acceptedFiles.length) onUploadImages?.(acceptedFiles);
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
    if (!onUploadImages) return;
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
        if (onUploadImages) {
          event.preventDefault();
          setIsDraggingUpload(true);
        }
      }}
      onDragLeave={() => setIsDraggingUpload(false)}
      onDrop={handleDrop}
    >
      <div className="shadcn-prototype-start-inner">
        <p className="shadcn-prototype-start-greet">{greetingLabel()}{accountName ? `，${accountName}` : ""}</p>
        <h1>今天想做什么内容？</h1>
        <p className="shadcn-prototype-start-sub">从一句话开始，MultiMix 会带着你的素材一起创作</p>
        <div className={dockClassName}>
          {imageAttachments.length ? (
            <div className="shadcn-prototype-chat-attachment-tray" aria-label="本次上传资料">
              {imageAttachments.map((attachment) => (
                <article key={attachment.id} className={attachment.status}>
                  {attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : <span className="shadcn-prototype-chat-attachment-fallback"><FileText size={14} aria-hidden="true" /></span>}
                  <div>
                    <strong title={attachment.title || attachment.fileName}>{attachment.title || attachment.fileName}</strong>
                    <em>{attachment.status === "ready" ? (attachment.fileKind === "image" ? "已识别" : "已入库") : attachment.status === "failed" ? attachment.error ?? "上传失败" : attachment.status === "processing" ? "解析中" : "上传中"}</em>
                  </div>
                  {attachment.status === "failed" ? <button type="button" onClick={() => onRetryImageAttachment?.(attachment.id)}>重试</button> : null}
                  <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => onRemoveImageAttachment?.(attachment.id)}>×</button>
                </article>
              ))}
            </div>
          ) : null}
          {isDraggingUpload ? <div className="shadcn-prototype-chat-drop-hint">释放以上传 PPT / 图片素材</div> : null}
          <textarea
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder="例如：把上周的安装案例做成一条小红书帖子…"
            rows={1}
            value={composerValue}
            disabled={!onSend}
            onChange={(event) => setComposerValue(event.currentTarget.value)}
            onInput={(event) => resizeComposer(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="shadcn-prototype-start-dock-bar">
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              multiple
              hidden
              onChange={handleImageInputChange}
            />
            <button
              className="shadcn-prototype-start-dock-attach"
              type="button"
              aria-label="上传图片素材"
              title="上传图片素材"
              disabled={!onSend || !onUploadImages}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImageIcon size={16} aria-hidden="true" />
            </button>
            <input
              ref={sourceInputRef}
              type="file"
              accept={SOURCE_UPLOAD_ACCEPT}
              multiple
              hidden
              onChange={handleSourceInputChange}
            />
            <button
              className="shadcn-prototype-start-dock-attach"
              type="button"
              aria-label="上传 PPT 或文档"
              title="上传 PPT 或文档"
              disabled={!onSend || !onUploadImages}
              onClick={() => sourceInputRef.current?.click()}
            >
              <FileText size={15} aria-hidden="true" />
            </button>
            <span className="shadcn-prototype-start-dock-hint">支持拖入 PPT / 图片素材 · 只上传资料时，AI 会先问你要做什么</span>
            <button
              className={sending ? "shadcn-prototype-start-dock-send stop" : "shadcn-prototype-start-dock-send"}
              type="button"
              aria-label={sending ? "停止" : "发送"}
              disabled={!onSend}
              onClick={sending ? stop : () => void submit()}
            >
              {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {imageAttachments.length ? <p className="shadcn-prototype-chat-attachment-help">{ATTACHMENT_HELP_TEXT}</p> : null}
        {error ? <p className="shadcn-prototype-composer-error">{error}</p> : null}
        {suggestions.length > 0 ? (
          <div className="shadcn-prototype-start-sugg-grid" aria-label="推荐指令">
            {suggestions.map((suggestion) => {
              const preset = SUGGESTION_PRESETS[suggestion];
              return (
                <button
                  type="button"
                  className="shadcn-prototype-start-sugg-card"
                  key={suggestion}
                  disabled={sending}
                  onClick={() => fillComposer(preset?.fill ?? suggestion)}
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
