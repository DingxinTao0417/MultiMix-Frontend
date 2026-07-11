"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dispatchAgentRunRetry,
  resolveAgentRunExpandedState,
  summarizeAgentRunSteps,
} from "../lib/agent-run-timeline-model";
import type { AgentRunStep } from "../lib/asset-workspace-types";

export type { AgentRunStep };

const MAX_ERROR_MESSAGE_LENGTH = 160;

function formatElapsedSeconds(seconds?: number) {
  if (typeof seconds !== "number") return undefined;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}秒`;
}

function truncateErrorMessage(message: string) {
  const normalized = message.trim();
  return normalized.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${normalized.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
    : normalized;
}

// Agent execution timeline (spec §5.2 ★). Renders only when real step events
// exist — callers pass an empty list to fall back to the shimmer wait state
// (spec §12 降级规则: 无事件不渲染). No fake progress.
export default function AgentRunTimeline({
  steps,
  errorMessage,
  onRetry,
  completionConfirmed,
}: {
  steps: AgentRunStep[];
  errorMessage?: string | null;
  onRetry?: (jobId: string) => void;
  completionConfirmed?: boolean;
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
  const failedStep = steps.find((step) => step.status === "fail");
  const retryJobId = failedStep?.retryJobId;
  const visibleError = summary.hasFailure && errorMessage
    ? truncateErrorMessage(errorMessage)
    : null;
  const title = summary.projectReady && summary.mgActive
    ? "视频工程已就绪 · MG 动效处理中"
    : summary.allDone
      ? "MultiMix 已完成"
      : summary.hasFailure
        ? "MultiMix 执行失败"
        : "MultiMix 正在执行";
  const countLabel = summary.allDone
    ? [`共 ${summary.total} 步`, summary.totalElapsedLabel].filter(Boolean).join(" · ")
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
        {summary.allDone ? (
          <span className="shadcn-prototype-agent-run-ok" aria-hidden="true"><Check size={10} /></span>
        ) : summary.hasFailure ? (
          <span className="shadcn-prototype-agent-run-failmark" aria-hidden="true">✕</span>
        ) : (
          <span className="shadcn-prototype-agent-run-dot" aria-hidden="true" />
        )}
        <span>{title}</span>
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
                  {step.status === "done" ? (
                    <span className="shadcn-prototype-agent-run-ok"><Check size={10} /></span>
                  ) : step.status === "run" ? (
                    <span className="shadcn-prototype-agent-run-active"><Sparkles size={10} /></span>
                  ) : step.status === "fail" ? (
                    <span className="shadcn-prototype-agent-run-failmark">✕</span>
                  ) : (
                    <span className="shadcn-prototype-agent-run-wait" />
                  )}
                </span>
                <span className="shadcn-prototype-agent-run-tx">{step.label}</span>
                <span className="shadcn-prototype-agent-run-tm">
                  {step.elapsedLabel ?? formatElapsedSeconds(step.elapsedSeconds) ?? "—"}
                </span>
                {step.status === "run" ? <span className="shadcn-prototype-agent-run-shim" /> : null}
              </li>
            ))}
          </ol>
          {summary.hasFailure && (visibleError || (onRetry && retryJobId)) ? (
            <div className="shadcn-prototype-agent-run-error">
              {visibleError ? <p>{visibleError}</p> : null}
              {onRetry && retryJobId ? (
                <button
                  type="button"
                  className="shadcn-prototype-agent-run-retry"
                  onClick={() => dispatchAgentRunRetry(retryJobId, onRetry)}
                >
                  重试失败步骤
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
