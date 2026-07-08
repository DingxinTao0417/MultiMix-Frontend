"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Square } from "lucide-react";
import type { Conversation } from "../lib/asset-workspace-shared";
import { formatComposerError } from "../../../lib/api";
import type { ChatImageAttachment } from "./conversation-studio";

const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
const SOURCE_UPLOAD_ACCEPT = ".pptx,.pdf,.docx,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm";
const IMAGE_ONLY_INSTRUCTION = "请先总结这些图片素材，并询问我想做视频、文案还是封面。";
const DOC_ONLY_INSTRUCTION = "请先阅读这些资料，并询问我想基于它做视频、文案还是总结。";
const ATTACHMENT_HELP_TEXT = "只上传资料时，我会先询问要基于它做什么；图片会作为素材，PPT/文档会作为来源资产。";

export default function ConversationStart({
  suggestions,
  onSend,
  conversation,
  imageAttachments = [],
  onUploadImages,
  onRemoveImageAttachment,
  onRetryImageAttachment
}: {
  suggestions: string[];
  onSend?: (conversation: Conversation, instruction: string, signal?: AbortSignal) => Promise<void>;
  conversation: Conversation;
  imageAttachments?: ChatImageAttachment[];
  onUploadImages?: (files: File[]) => void;
  onRemoveImageAttachment?: (attachmentId: string) => void;
  onRetryImageAttachment?: (attachmentId: string) => void;
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
    textarea.style.height = "34px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  const submit = async () => {
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

  const canSend = Boolean(onSend) && !sending;
  const composerControlClassName = [
    imageAttachments.length
      ? "shadcn-prototype-composer-control shadcn-prototype-start-composer-control has-attachments"
      : "shadcn-prototype-composer-control shadcn-prototype-start-composer-control",
    isDraggingUpload ? "drag-active" : ""
  ].filter(Boolean).join(" ");

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
        <h1>新建对话</h1>
        <div className="shadcn-prototype-start-composer">
          <div className={composerControlClassName}>
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
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              multiple
              hidden
              onChange={handleImageInputChange}
            />
            <button
              className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-image-attachment-button"
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
              className="shadcn-prototype-chat-attachment-button shadcn-prototype-chat-file-attachment-button"
              type="button"
              aria-label="上传 PPT 或文档"
              title="上传 PPT 或文档"
              disabled={!onSend || !onUploadImages}
              onClick={() => sourceInputRef.current?.click()}
            >
              <FileText size={15} aria-hidden="true" />
            </button>
            <textarea
              ref={composerRef}
              aria-label="输入对话内容"
              placeholder="输入创作需求，或拖入 PPT/图片素材"
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
            <button
              className={sending ? "primary stop" : "primary"}
              type="button"
              aria-label={sending ? "停止" : "发送"}
              disabled={!sending && (!canSend || (!composerValue.trim() && !hasReadyImageAttachment && !hasReadySourceAttachment))}
              onClick={sending ? stop : () => void submit()}
            >
              {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {imageAttachments.length ? <p className="shadcn-prototype-chat-attachment-help">{ATTACHMENT_HELP_TEXT}</p> : null}
        {error ? <p className="shadcn-prototype-composer-error">{error}</p> : null}
        {suggestions.length > 0 ? (
          <div className="shadcn-prototype-start-suggestions" aria-label="推荐指令">
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                disabled={sending}
                onClick={() => {
                  setComposerValue(suggestion);
                  requestAnimationFrame(() => {
                    composerRef.current?.focus();
                    if (composerRef.current) {
                      resizeComposer(composerRef.current);
                    }
                  });
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
