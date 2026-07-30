"use client";

import { Check, ChevronDown, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  dispatchAgentRunRetry,
  executionErrorPresentation,
  resolveAgentRunExpandedState,
  summarizeAgentRunSteps,
} from "../lib/agent-run-timeline-model";
import type { AgentRunStep } from "../lib/asset-workspace-types";

export type { AgentRunStep };

function formatElapsedSeconds(seconds?: number) {
  if (typeof seconds !== "number") return undefined;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}秒`;
}

function RunStatusIcon({ status }: { status: AgentRunStep["status"] }) {
  if (status === "done") {
    return <span className="shadcn-prototype-agent-run-ok"><Check size={12} strokeWidth={3} /></span>;
  }
  if (status === "run") {
    return <span className="shadcn-prototype-agent-run-active"><Sparkles size={10} /></span>;
  }
  if (status === "fail") {
    return <span className="shadcn-prototype-agent-run-failmark"><X size={12} strokeWidth={3} /></span>;
  }
  return <span className="shadcn-prototype-agent-run-wait" />;
}

function visibleStepLabel(step: AgentRunStep) {
  if (step.key !== "mg_overlay") return step.label;
  if (step.status === "done") {
    return step.label.startsWith("已") ? step.label : `已${step.label}`;
  }
  return step.label.startsWith("后台") ? step.label : `后台${step.label}`;
}

// Agent execution timeline (spec §5.2 ★). Renders only when real step events
// exist — callers pass an empty list to fall back to the shimmer wait state
// (spec §12 降级规则: 无事件不渲染). No fake progress.
export default function AgentRunTimeline({
  steps,
  title = "视频生成进度",
  statusTone: statusToneOverride,
  errorMessage,
  onRetry,
  completionConfirmed,
  footer,
}: {
  steps: AgentRunStep[];
  title?: string;
  statusTone?: "success" | "fail" | "running" | "cancelled";
  errorMessage?: string | null;
  onRetry?: (jobId: string) => void;
  completionConfirmed?: boolean;
  footer?: ReactNode;
}) {
  const summary = summarizeAgentRunSteps(steps);
  const [expansionState, setExpansionState] = useState(() => (
    resolveAgentRunExpandedState(undefined, {
      type: "sync",
      allDone: summary.allDone,
      completionConfirmed,
    })
  ));
  const expanded = expansionState.expanded;

  useEffect(() => {
    setExpansionState((current) => resolveAgentRunExpandedState(current, {
      type: "sync",
      allDone: summary.allDone,
      completionConfirmed,
    }));
  }, [summary.allDone, completionConfirmed]);

  if (!steps.length) return null;

  const runningIndex = steps.findIndex((step) => step.status === "run");
  const failedIndex = steps.findIndex((step) => step.status === "fail");
  const currentStep = runningIndex >= 0
    ? runningIndex + 1
    : failedIndex >= 0
      ? failedIndex + 1
      : Math.min(summary.total, summary.doneCount + 1);
  const retryStep = steps.find(
    (step) => step.status === "fail" && step.retryJobId,
  ) ?? steps.find((step) => step.retryJobId);
  const retryJobId = retryStep?.retryJobId;
  const errorPresentation = summary.hasFailure
    ? executionErrorPresentation(errorMessage ?? "")
    : null;
  const statusTone = statusToneOverride ?? (summary.allDone
    ? "success"
    : summary.hasFailure
      ? "fail"
      : "running");
  const countLabel = summary.projectReady && summary.mgActive
    ? `视频已生成，可立即编辑 · 第 ${currentStep} 步 / 共 ${summary.total} 步`
    : summary.allDone
    ? [`共 ${summary.total} 步`, summary.totalElapsedLabel ? `总历时 ${summary.totalElapsedLabel}` : undefined].filter(Boolean).join(" · ")
    : `第 ${currentStep} 步 / 共 ${summary.total} 步`;

  return (
    <div
      className={`shadcn-prototype-agent-run${expanded ? "" : " collapsed"}`}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="shadcn-prototype-agent-run-head"
        aria-expanded={expanded}
        onClick={() => setExpansionState((current) => (
          resolveAgentRunExpandedState(current, { type: "toggle" })
        ))}
      >
        <span className="shadcn-prototype-agent-run-title">
          {title}
          <span className={`shadcn-prototype-agent-run-title-status ${statusTone}`}>
            <span className="shadcn-prototype-agent-run-title-dot" aria-hidden="true" />
          </span>
        </span>
        <span className="shadcn-prototype-agent-run-count">{countLabel}</span>
        <ChevronDown
          className={`shadcn-prototype-agent-run-chevron${expanded ? " expanded" : ""}`}
          size={15}
          aria-hidden="true"
        />
      </button>
      {expanded ? (
        <>
          <ol className="shadcn-prototype-agent-run-steps">
            {steps.map((step) => (
              <li key={step.key} className={`shadcn-prototype-agent-run-step ${step.status}`}>
                <span className="shadcn-prototype-agent-run-ic" aria-hidden="true">
                  <RunStatusIcon status={step.status} />
                </span>
                <span className="shadcn-prototype-agent-run-tx">{visibleStepLabel(step)}</span>
                <span className="shadcn-prototype-agent-run-tm">
                  {step.elapsedLabel ?? formatElapsedSeconds(step.elapsedSeconds) ?? "—"}
                </span>
                {step.status === "run" ? <span className="shadcn-prototype-agent-run-shim" /> : null}
              </li>
            ))}
          </ol>
          {summary.hasFailure && (errorPresentation || (onRetry && retryJobId)) ? (
            <div className="shadcn-prototype-agent-run-error">
              {errorPresentation ? (
                <div className="shadcn-prototype-agent-run-error-copy">
                  <details>
                    <summary>查看技术详情</summary>
                    <code>{errorPresentation.technicalDetail}</code>
                  </details>
                </div>
              ) : null}
              {onRetry && retryJobId ? (
                <button
                  type="button"
                  className="shadcn-prototype-agent-run-retry"
                  onClick={() => dispatchAgentRunRetry(retryJobId, onRetry)}
                >
                  重新执行此步骤
                </button>
              ) : null}
            </div>
          ) : null}
          {footer ? <div className="shadcn-prototype-agent-run-actions">{footer}</div> : null}
        </>
      ) : null}
    </div>
  );
}
