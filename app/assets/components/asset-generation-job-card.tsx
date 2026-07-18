"use client";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { formatComposerError } from "../../../lib/api";

function failureMessage(job: AssetGenerationJobResponse): string {
  if (job.error_code === "provider_timeout") {
    return "内容生成超时，本轮没有创建产物，可以直接重试。";
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
}: {
  job: AssetGenerationJobResponse;
  onRetry?: (jobId: string) => void;
}) {
  const label = job.status === "queued"
    ? "内容生成已排队"
    : job.status === "running"
      ? "正在生成内容…"
      : job.status === "completed"
        ? "内容生成已完成"
        : "内容生成失败";

  return (
    <div
      className={`shadcn-prototype-generation-job-card status-${job.status}`}
      data-generation-job-id={job.id}
      aria-live="polite"
    >
      <strong>{label}</strong>
      {job.status === "failed" ? <p>{failureMessage(job)}</p> : null}
      {job.status === "failed" && onRetry ? (
        <button type="button" onClick={() => onRetry(job.id)}>
          重试生成
        </button>
      ) : null}
    </div>
  );
}
