"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Play, Square, Video } from "lucide-react";
import { getConversationProducts, getProductModeLabel, type Conversation, type ProductArtifact } from "../lib/asset-workspace-shared";
import { formatComposerError } from "../../../lib/api";
import type { AssetConversationMessage } from "../lib/asset-workspace-types";

type VisibleConversationMessage = AssetConversationMessage & { pending?: boolean };

type OptimisticExchange = {
  id: string;
  userText: string;
  assistantText: string;
  status: "pending" | "stopped" | "failed";
};

function fallbackProductMessageIndex(messages: VisibleConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.pending && !message.suggestions?.length) return index;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.pending) return index;
  }
  return -1;
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

export default function ConversationStudio({
  basePath,
  selectedConversation,
  selectedProduct,
  onSelectProduct,
  onSendMessage,
  readonly = false
}: {
  basePath: string;
  selectedConversation: Conversation;
  selectedProduct: ProductArtifact | null;
  onSelectProduct: (conversationId: string, productId: string) => void;
  onSendMessage?: (conversation: Conversation, instruction: string, signal?: AbortSignal) => Promise<void>;
  readonly?: boolean;
}) {
  const products = getConversationProducts(selectedConversation);
  const [composerValue, setComposerValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [optimisticExchange, setOptimisticExchange] = useState<OptimisticExchange | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

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

  const visibleConversationMessages = useMemo<VisibleConversationMessage[]>(() => (
    optimisticExchange
      ? [
        ...conversationMessages,
        { role: "user" as const, text: optimisticExchange.userText },
        { role: "assistant" as const, text: optimisticExchange.assistantText, pending: optimisticExchange.status === "pending" }
      ]
      : conversationMessages
  ), [conversationMessages, optimisticExchange]);

  const productCardsByMessageIndex = useMemo(
    () => mapProductsToConversationMessages(visibleConversationMessages, products),
    [visibleConversationMessages, products]
  );

  const resizeComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "48px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    setOptimisticExchange(null);
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setSending(false);
    setSendError(null);
    setComposerValue("");
  }, [selectedConversation.id]);

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  const submitInstruction = async () => {
    const instruction = composerValue.trim();
    if (readonly || !onSendMessage || !instruction || sending) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setSending(true);
    setSendError(null);
    setComposerValue("");
    setOptimisticExchange({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userText: instruction,
      assistantText: "正在生成",
      status: "pending"
    });
    try {
      await onSendMessage(selectedConversation, instruction, controller.signal);
      if (controller.signal.aborted) return;
      setOptimisticExchange(null);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        setOptimisticExchange((current) => current ? { ...current, assistantText: "已停止生成。", status: "stopped" } : current);
        return;
      }
      const message = formatComposerError(error);
      setOptimisticExchange((current) => current ? { ...current, assistantText: message, status: "failed" } : current);
      setSendError(message);
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      setSending(false);
    }
  };

  const stopGeneration = () => {
    if (!sending) return;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setSending(false);
    setOptimisticExchange((current) => current ? { ...current, assistantText: "已停止生成。", status: "stopped" } : current);
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
              ) : product.mode === "video" || product.mode === "digital-human" ? (
                <Video size={15} aria-hidden="true" />
              ) : (
                <FileText size={15} aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{product.title}</strong>
              <em>{getProductModeLabel(product.mode)} · {product.status}</em>
            </span>
            {product.version ? <small>{product.version}</small> : null}
          </Link>
        ))}
      </div>
    );
  };

  const canSend = Boolean(onSendMessage) && !readonly;

  return (
    <section className="shadcn-prototype-card shadcn-prototype-chat" aria-label="Content generation conversation">
      <div className="shadcn-prototype-thread">
        {visibleConversationMessages.map((message, index) => (
          <div className="shadcn-prototype-message-group" key={`${message.role}-${index}-${message.text}`}>
            <article className={[
              message.suggestions?.length ? `${message.role} delivery` : message.role,
              message.pending ? "pending" : ""
            ].filter(Boolean).join(" ")}>
              <p>
                {message.text}
                {message.pending ? <span className="shadcn-prototype-typing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span> : null}
              </p>
              {message.suggestions?.length ? (
                <div className="shadcn-prototype-suggestion-row" aria-label="推荐调整指令">
                  {message.suggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      disabled={!canSend}
                      onClick={() => {
                        if (!canSend) return;
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
            </article>
            {renderProductCards(index)}
          </div>
        ))}
      </div>

      <form className={canSend ? "shadcn-prototype-composer" : "shadcn-prototype-composer readonly"} onSubmit={handleSubmit}>
        <div className="shadcn-prototype-composer-control">
          <textarea
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder={canSend ? "输入创作需求，或整理资料内容" : "参考样例只读"}
            rows={1}
            value={composerValue}
            disabled={!canSend}
            onChange={(event) => setComposerValue(event.currentTarget.value)}
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
            disabled={!canSend || (!sending && !composerValue.trim())}
            onClick={sending ? stopGeneration : undefined}
          >
            {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
          </button>
        </div>
        {sendError ? <p className="shadcn-prototype-composer-error">{sendError}</p> : null}
      </form>
    </section>
  );
}
