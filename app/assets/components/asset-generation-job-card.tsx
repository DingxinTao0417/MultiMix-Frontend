"use client";

import { useEffect, useState } from "react";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { formatComposerError } from "../../../lib/api";
import { generationElapsedLabel, generationProgressEvents, generationTerminalSummary } from "../lib/asset-generation-progress";

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
  const [expanded, setExpanded] = useState(job.status === "queued" || job.status === "running" || job.status === "failed");
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const canCancel = job.status === "queued" || job.status === "running";
  const terminal = job.status === "completed" || job.status === "cancelled";
  const events = generationProgressEvents(job);
  const elapsed = generationElapsedLabel(job, now);

  useEffect(() => {
    setExpanded(job.status === "queued" || job.status === "running" || job.status === "failed");
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
      className={`shadcn-prototype-generation-job-card status-${job.status}`}
      data-generation-job-id={job.id}
      aria-live="polite"
    >
      <div className="shadcn-prototype-generation-job-copy">
        {terminal ? (
          <button type="button" className="shadcn-prototype-generation-job-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {generationTerminalSummary(job)} <span>{expanded ? "收起" : "展开"}</span>
          </button>
        ) : <strong>{stopping ? "正在停止生成…" : events.at(-1)?.label}</strong>}
        {elapsed ? <small>{elapsed}</small> : null}
        {expanded ? (
          <ol className="shadcn-prototype-generation-job-steps">
            {events.map((event) => <li key={`${event.key}-${event.occurred_at}`} className={event.status}><i aria-hidden="true" /> <span><b>{event.label}</b>{event.detail ? <em>{event.detail}</em> : null}</span></li>)}
          </ol>
        ) : null}
        {job.status === "failed" ? <p>{failureMessage(job)}</p> : null}
        {job.status === "cancelled" && expanded ? <p>已停止本次内容生成，没有创建产物。</p> : null}
      </div>
      <div className="shadcn-prototype-generation-job-actions">
        {canCancel && onCancel ? <button type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? "正在停止…" : "停止生成"}</button> : null}
        {job.status === "failed" && onRetry ? <button type="button" onClick={() => void onRetry(job.id)}>重试生成</button> : null}
      </div>
    </div>
  );
}
