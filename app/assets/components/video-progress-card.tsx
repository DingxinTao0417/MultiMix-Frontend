"use client";

import { Check, ChevronDown, Minus, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  videoProgressPresentation,
  type VideoProgressInput,
  type VideoProgressMilestone,
} from "../lib/video-progress-presentation";

function MilestoneIcon({ status }: { status: VideoProgressMilestone["status"] }) {
  if (status === "done") {
    return <span className="shadcn-prototype-agent-run-ok"><Check size={12} strokeWidth={3} /></span>;
  }
  if (status === "fail") {
    return <span className="shadcn-prototype-agent-run-failmark"><X size={12} strokeWidth={3} /></span>;
  }
  if (status === "stopped") {
    return <span className="shadcn-prototype-agent-run-wait"><Minus size={10} /></span>;
  }
  return <span className="shadcn-prototype-agent-run-active"><Sparkles size={10} /></span>;
}

export type VideoProgressCardProps = VideoProgressInput & {
  errorMessage?: string | null;
  actions?: ReactNode;
  completionLabel?: string;
};

export function VideoProgressCard({ errorMessage, actions, completionLabel, ...input }: VideoProgressCardProps) {
  const presentation = videoProgressPresentation(input);
  const [expanded, setExpanded] = useState(false);
  const collapsedOnSuccess = useRef(false);
  const detailsId = useId();
  useEffect(() => {
    if (presentation.completed && !collapsedOnSuccess.current) {
      collapsedOnSuccess.current = true;
      setExpanded(false);
    }
  }, [presentation.completed]);

  const description = input.status === "failed" && errorMessage?.trim()
    ? errorMessage.trim() : presentation.description;
  const toggle = presentation.milestones.length ? (
    <button
      type="button"
      className="shadcn-prototype-video-task-progress-toggle"
      aria-label={expanded ? "收起进度详情" : "查看进度详情"}
      aria-expanded={expanded}
      aria-controls={detailsId}
      onClick={() => setExpanded((current) => !current)}
    >
      {!presentation.completed ? (expanded ? "收起进度详情" : "查看进度详情") : null}
      <ChevronDown
        className={expanded ? "shadcn-prototype-agent-run-chevron expanded" : "shadcn-prototype-agent-run-chevron"}
        size={15}
        aria-hidden="true"
      />
    </button>
  ) : null;

  return (
    <section
      className={"shadcn-prototype-agent-run shadcn-prototype-video-task-progress"
        + (expanded ? "" : " collapsed") + (presentation.completed ? " completed" : "")}
      aria-label="视频任务进度"
    >
      <div className="shadcn-prototype-video-task-progress-summary">
        <div className="shadcn-prototype-video-task-progress-heading">
          <div role="status" aria-live="polite" aria-atomic="true">
            <span className="shadcn-prototype-agent-run-title">
              <span className={"shadcn-prototype-agent-run-title-status " + presentation.tone} aria-hidden="true">
                {presentation.tone === "success" ? <Check size={15} />
                  : presentation.tone === "fail" ? <X size={15} />
                  : presentation.tone === "cancelled" ? <Minus size={15} />
                  : <span className="shadcn-prototype-agent-run-title-dot" />}
              </span>
              {presentation.completed ? completionLabel ?? presentation.title : presentation.title}
            </span>
            {description ? <p className="shadcn-prototype-video-task-progress-description">{description}</p> : null}
          </div>
          {presentation.completed ? toggle : null}
        </div>
        {actions || !presentation.completed ? (
          <div className="shadcn-prototype-video-task-progress-controls">
            {!presentation.completed ? toggle : null}
            {actions ? <div className="shadcn-prototype-agent-run-actions">{actions}</div> : null}
          </div>
        ) : null}
      </div>
      {expanded ? (
        <ol id={detailsId} className="shadcn-prototype-agent-run-steps" aria-label="视频关键进展">
          {presentation.milestones.map((milestone) => (
            <li key={milestone.key} className={"shadcn-prototype-agent-run-step " + milestone.status}>
              <span className="shadcn-prototype-agent-run-ic" aria-hidden="true">
                <MilestoneIcon status={milestone.status} />
              </span>
              <span className="shadcn-prototype-agent-run-tx">{milestone.label}</span>
              <span className="shadcn-prototype-video-task-progress-sr-only">
                {milestone.status === "done" ? "已完成" : milestone.status === "fail" ? "未完成"
                  : milestone.status === "stopped" ? "已停止" : "进行中"}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
