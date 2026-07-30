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
  if (job.error_code === "provider_timeout") {
    return "内容生成超时，本轮没有创建产物，可以直接重试。";
  }
  if (job.error_code === "provider_stalled") {
    return "模型长时间没有任何新响应，本轮没有创建产物，可以直接重试。";
  }
  if (job.error_code === "stale_input") {
    return "当前作品已经更新，本次旧任务没有覆盖新版本。";
  }
  if (job.error_code === "worker_abandoned") {
    return "内容生成任务在服务重启后中断，本轮没有创建产物，可以直接重试。";
  }
  if (job.error_message) return formatComposerError(new Error(job.error_message));
  return "内容生成失败，本轮没有创建产物，可以直接重试。";
}

export function AssetGenerationJobCard({
  job,
  onRetry,
  onCancel,
}: {
  job: AssetGenerationJobResponse;
  onRetry?: (jobId: string) => void | Promise<void>;
  onCancel?: (jobId: string) => void | Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const canCancel = job.status === "queued" || job.status === "running";
  const terminal = job.status === "completed" || job.status === "cancelled";

  useEffect(() => {
    if (!canCancel) setStopping(false);
  }, [canCancel, job.status]);
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
        onRetry={onRetry ? (jobId) => { void onRetry(jobId); } : undefined}
        completionConfirmed={terminal}
        footer={canCancel && onCancel ? (
          <button
            type="button"
            className="shadcn-prototype-agent-run-stop"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? "正在停止…" : "停止生成"}
          </button>
        ) : null}
      />
    </div>
  );
}
