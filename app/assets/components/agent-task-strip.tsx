"use client";

import { CornerUpLeft } from "lucide-react";

import type { AgentTaskCollection } from "../lib/asset-workspace-types";

export default function AgentTaskStrip({
  tasks,
  onResume,
  disabled = false,
}: {
  tasks: AgentTaskCollection;
  onResume: (goal: string) => void;
  disabled?: boolean;
}) {
  if (!tasks.active && !tasks.paused.length) return null;
  const returnTask = tasks.paused.at(-1);

  return (
    <aside className="shadcn-prototype-agent-task-strip" aria-label="Agent 任务状态">
      <div>
        <strong>{tasks.active ? `当前：${tasks.active.goal}` : "当前没有进行中的任务"}</strong>
        {tasks.paused.length ? <span>{tasks.paused.length} 个任务已暂停</span> : null}
      </div>
      {returnTask ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onResume(returnTask.goal)}
        >
          <CornerUpLeft size={14} aria-hidden="true" />
          返回 {returnTask.goal}
        </button>
      ) : null}
    </aside>
  );
}
