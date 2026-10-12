"use client";

// Background task the AI is working on off the conversation thread.
export type AiBackgroundTask = {
  id: string;
  title: string;
  // Merchant-facing note; e.g. "完成后可直接在对话中引用".
  note?: string;
};

// Header AI background-status pill. It lives next to the page actions because
// the persistent sidebar it used to sit in was retired. The gradient dot is an
// "AI is working" moment, so it is allowed by the gradient rule. Renders
// nothing without a real background task: no placeholder, no fake data.
export default function AiBackgroundStatus({ tasks }: { tasks: AiBackgroundTask[] }) {
  if (!tasks.length) return null;
  const primary = tasks[0];
  const detail = [
    `正在理解「${primary.title}」`,
    tasks.length > 1 ? `等 ${tasks.length} 项` : "",
    primary.note ? `，${primary.note}` : "，完成后可用于视频创作。",
  ].join("");
  return (
    <div className="shadcn-prototype-ai-status" aria-live="polite" title={detail}>
      <span className="shadcn-prototype-ai-status-dot" aria-hidden="true" />
      <span className="shadcn-prototype-ai-status-head">AI 正在理解素材</span>
      <span className="shadcn-prototype-visually-hidden">{detail}</span>
    </div>
  );
}
