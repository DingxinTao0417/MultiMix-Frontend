"use client";

import { useEffect, useState } from "react";

import {
  getVideoStoryboardJob,
  retryVideoStoryboardJob,
  type VideoStoryboardJob,
} from "../lib/video-storyboard-client";

const POLL_INTERVAL_MS = 1_200;

function progressLabel(job: VideoStoryboardJob | null): string {
  if (!job) return "正在读取分镜识别状态…";
  if (job.status === "completed") {
    const count = job.storyboard?.scene_count ?? 0;
    return count > 0 ? `已识别 ${count} 个分镜` : "分镜识别已完成";
  }
  if (job.status === "failed") return job.message || "分镜识别未完成。";
  if (job.stage === "reading_source") return "正在读取视频…";
  if (job.stage === "analyzing") return "正在识别并拆分分镜…";
  return "正在准备识别分镜…";
}

export default function ExternalVideoStoryboardProgress({
  token,
  sourceAssetId,
  jobId,
}: {
  token: string;
  sourceAssetId: number;
  jobId: string;
}) {
  const [job, setJob] = useState<VideoStoryboardJob | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getVideoStoryboardJob(token, sourceAssetId, jobId);
        if (cancelled) return;
        setJob(next);
        setReadError(null);
        if (next.status === "queued" || next.status === "running") {
          timer = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        setReadError(error instanceof Error ? error.message : "暂时无法读取分镜识别进度。");
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId, refreshRevision, sourceAssetId, token]);

  const retry = async () => {
    if (!job?.retryable || retrying) return;
    setRetrying(true);
    try {
      const next = await retryVideoStoryboardJob(token, sourceAssetId, jobId);
      setJob(next);
      setReadError(null);
      setRefreshRevision((value) => value + 1);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "重试失败，请稍后再试。");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section
      className="shadcn-prototype-generation-job-timeline"
      aria-label="分镜识别进度"
      data-storyboard-job-id={jobId}
    >
      <div className="shadcn-prototype-agent-run">
        <div className="shadcn-prototype-agent-run-head">
          <strong className="shadcn-prototype-agent-run-title">分镜识别进度</strong>
        </div>
        <p role="status">{progressLabel(job)}</p>
        {job?.status === "completed" ? (
          <p>现在可以直接说“把第 2 镜改成动画”。</p>
        ) : null}
        {readError ? <p role="alert">{readError}</p> : null}
        {job?.status === "failed" && job.retryable ? (
          <button
            type="button"
            className="shadcn-prototype-agent-run-retry"
            disabled={retrying}
            onClick={() => { void retry(); }}
          >
            {retrying ? "正在重试…" : "重试分镜识别"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
