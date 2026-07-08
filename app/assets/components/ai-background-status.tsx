"use client";

// Background task the AI is working on off the conversation thread (spec §5.1 ★).
export type AiBackgroundTask = {
  id: string;
  title: string;
  // Merchant-facing note; e.g. "完成后可直接在对话中引用".
  note?: string;
};

// Sidebar AI background-status capsule (spec §5.1 ★). Gradient-bordered small
// card between the conversation list and the user block. Renders nothing when
// there is no background task (spec §12: 无任务即隐藏, 本为设计态). No fake data.
export default function AiBackgroundStatus({ tasks }: { tasks: AiBackgroundTask[] }) {
  if (!tasks.length) return null;
  const primary = tasks[0];
  const extra = tasks.length - 1;
  return (
    <div className="shadcn-prototype-ai-status" aria-live="polite">
      <div className="shadcn-prototype-ai-status-head">
        <span className="shadcn-prototype-ai-status-dot" aria-hidden="true" />
        AI 正在后台工作
      </div>
      <p className="shadcn-prototype-ai-status-body">
        正在理解 <b>「{primary.title}」</b>
        {extra > 0 ? ` 等 ${tasks.length} 项` : ""}
        {primary.note ? `，${primary.note}` : "。"}
      </p>
    </div>
  );
}
