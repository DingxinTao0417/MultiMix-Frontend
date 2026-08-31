"use client";

import { useEffect, useState } from "react";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { formatComposerError } from "../../../lib/api";
import {
  generationTimelineSteps,
  generationTimelineTitle,
} from "../lib/asset-generation-progress";
import AgentRunTimeline from "./agent-run-timeline";

function failureMessage(job: AssetGenerationJobResponse): string {
  if (job.error_message) return formatComposerError(new Error(job.error_message));
  return "内容生成失败，本轮没有创建产物，可以直接重试。";
}

export function AssetGenerationJobCard({
  job,
  onRetry,
  onCancel,
  completionLabel,
}: {
  job: AssetGenerationJobResponse;
  onRetry?: (jobId: string) => void | Promise<void>;
  onCancel?: (jobId: string) => void | Promise<void>;
  completionLabel?: string;
}) {
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const canCancel = job.status === "queued" || job.status === "running";
  const terminal = job.status === "completed" || job.status === "cancelled";

  useEffect(() => {
    if (!canCancel) setStopping(false);
  }, [canCancel, job.status]);
  useEffect(() => {
    if (job.status !== "failed" && job.status !== "cancelled") setRetrying(false);
  }, [job.status]);
  useEffect(() => {
    if (job.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.status]);

  const stop = async () => {
    if (!onCancel || stopping) return;
    setStopping(true);
    try { await onCancel(job.id); } catch { setStopping(false); }
  };
  const retry = async (jobId: string) => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try { await onRetry(jobId); } catch { setRetrying(false); }
  };
  const retryStopped = () => {
    if (job.status === "cancelled") void retry(job.id);
  };
  const isDirectorScriptGeneration = generationTimelineTitle(job) === "编导稿生成进度";

  return (
    <div
      className="shadcn-prototype-generation-job-timeline"
      data-generation-job-id={job.id}
      aria-live="polite"
    >
      <AgentRunTimeline
        steps={generationTimelineSteps(job, now)}
        title={generationTimelineTitle(job)}
        statusTone={job.status === "cancelled" ? "cancelled" : undefined}
        errorMessage={job.status === "failed" ? failureMessage(job) : null}
        onRetry={onRetry ? (jobId) => { void retry(jobId); } : undefined}
        retrying={retrying}
        completionConfirmed={terminal}
        completionLabel={completionLabel ?? (isDirectorScriptGeneration
          ? "编导脚本已生成，可确认或修改"
          : "内容已生成，可查看")}
        footer={canCancel && onCancel ? (
          <button
            type="button"
            className="shadcn-prototype-agent-run-stop"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? "正在停止…" : "停止生成"}
          </button>
        ) : job.status === "cancelled" && onRetry ? (
          <button
            type="button"
            className="shadcn-prototype-agent-run-retry"
            disabled={retrying}
            onClick={retryStopped}
          >
            {retrying ? "正在重试…" : "重新生成"}
          </button>
        ) : null}
      />
    </div>
  );
}
