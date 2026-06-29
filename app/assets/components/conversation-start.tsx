"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { Conversation } from "../lib/asset-workspace-shared";
import { formatComposerError } from "../../../lib/api";

export default function ConversationStart({
  suggestions,
  onSend,
  conversation
}: {
  suggestions: string[];
  onSend?: (conversation: Conversation, instruction: string, signal?: AbortSignal) => Promise<void>;
  conversation: Conversation;
}) {
  const [composerValue, setComposerValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const resizeComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "52px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  const submit = async () => {
    const instruction = composerValue.trim();
    if (!instruction || !onSend || sending) return;
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

  const canSend = Boolean(onSend) && !sending;

  return (
    <section className="shadcn-prototype-start" aria-label="新建对话">
      <div className="shadcn-prototype-start-inner">
        <h1>新建对话</h1>
        <div className="shadcn-prototype-start-composer">
          <textarea
            ref={composerRef}
            aria-label="输入对话内容"
            placeholder="输入创作需求，或整理资料内容"
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
            disabled={!canSend && !sending}
            onClick={sending ? stop : () => void submit()}
          >
            {sending ? <Square size={13} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={17} aria-hidden="true" />}
          </button>
        </div>
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
