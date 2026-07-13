"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export const WAITING_STATE_DELAY_MS = 500;

export function useDelayedWaitingVisibility(delayMs = WAITING_STATE_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return visible;
}

export function ConversationDetailSkeleton({
  delayMs = WAITING_STATE_DELAY_MS,
}: {
  delayMs?: number;
}) {
  const visible = useDelayedWaitingVisibility(delayMs);
  if (!visible) return null;

  return (
    <div className="shadcn-prototype-conversation-skeleton" role="status" aria-live="polite">
      <span className="shadcn-prototype-conversation-skeleton-label">载入对话…</span>
      <div className="shadcn-prototype-conversation-skeleton-list" aria-hidden="true">
        <span className="shadcn-prototype-conversation-skeleton-row assistant"><i /><i /></span>
        <span className="shadcn-prototype-conversation-skeleton-row user"><i /><i /></span>
        <span className="shadcn-prototype-conversation-skeleton-row assistant short"><i /><i /></span>
      </div>
    </div>
  );
}

export function AssistantReplyPending({
  delayMs = WAITING_STATE_DELAY_MS,
}: {
  delayMs?: number;
}) {
  const visible = useDelayedWaitingVisibility(delayMs);
  if (!visible) return null;

  return (
    <span className="shadcn-prototype-assistant-waiting" role="status" aria-live="polite">
      <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
      正在整理内容
      <span className="shadcn-prototype-assistant-waiting-dots" aria-hidden="true">
        <i /><i /><i />
      </span>
    </span>
  );
}
