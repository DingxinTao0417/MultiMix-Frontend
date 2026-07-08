"use client";

import { Check, Sparkles } from "lucide-react";

// A single agent execution step, mapped from real backend task events. Status
// drives the three visual states in spec §5.2: done (green check + elapsed),
// run (gradient breathing icon + shimmer bar), wait (hollow circle + —).
export type AgentRunStep = {
  key: string;
  label: string;
  status: "done" | "run" | "wait" | "fail";
  elapsedLabel?: string;
};

// Agent execution timeline (spec §5.2 ★). Renders only when real step events
// exist — callers pass an empty list to fall back to the shimmer wait state
// (spec §12 降级规则: 无事件不渲染). No fake progress.
export default function AgentRunTimeline({ steps, title = "MultiMix 正在执行" }: { steps: AgentRunStep[]; title?: string }) {
  if (!steps.length) return null;
  const total = steps.length;
  const runningIndex = steps.findIndex((step) => step.status === "run");
  const doneCount = steps.filter((step) => step.status === "done").length;
  const currentStep = runningIndex >= 0 ? runningIndex + 1 : Math.min(total, doneCount + 1);
  const allDone = doneCount === total;
  return (
    <div className="shadcn-prototype-agent-run" role="status" aria-live="polite">
      <div className="shadcn-prototype-agent-run-head">
        {allDone ? null : <span className="shadcn-prototype-agent-run-dot" aria-hidden="true" />}
        <span>{allDone ? "MultiMix 已完成" : title}</span>
        <span className="shadcn-prototype-agent-run-count">{allDone ? `共 ${total} 步` : `第 ${currentStep} 步 / 共 ${total} 步`}</span>
      </div>
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
            <span className="shadcn-prototype-agent-run-tm">{step.elapsedLabel ?? "—"}</span>
            {step.status === "run" ? <span className="shadcn-prototype-agent-run-shim" /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
