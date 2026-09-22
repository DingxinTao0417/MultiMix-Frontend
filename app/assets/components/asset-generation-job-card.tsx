"use client";

import { useEffect, useState } from "react";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { formatComposerError } from "../../../lib/api";
import {
  generationProviderWaitLabel,
  generationTimelineSteps,
  generationTimelineTitle,
} from "../lib/asset-generation-progress";
import AgentRunTimeline from "./agent-run-timeline";
import { VideoProgressCard } from "./video-progress-card";
import { resolveProgressKind } from "../lib/video-progress-presentation";

function failureMessage(job: AssetGenerationJobResponse): string {
  if (job.error_message)
    return formatComposerError(new Error(job.error_message));
  return "内容生成失败，本轮没有创建产物，可以直接重试。";
}

const checkpointStageLabels: Record<string, string> = {
  base_draft: "初步内容",
  creative_profile: "创作设定",
  creative_direction: "创意方向",
  scene_structure: "分镜结构",
  scene_direction: "分镜内容",
  grounding_review: "内容核验",
  topic_alignment: "整体校对",
  narration_and_visual_contracts: "声音与画面安排",
  director_draft: "视频方案",
};

function checkpointStageLabel(stage: string): string {
  return checkpointStageLabels[stage.split("/")[0] ?? ""] ?? "当前步骤";
}

function intermediateResultDetail(
  result: NonNullable<
    AssetGenerationJobResponse["intermediate_results"]
  >[number],
): string {
  const projection = result.public_projection;
  if (result.stage === "creative_direction") {
    return (
      projection.selected_candidate?.angle ||
      projection.selected_candidate?.hook ||
      "方向已确定"
    );
  }
  if (result.stage === "scene_structure") {
    const scenes = projection.scenes ?? [];
    if (scenes.length > 0) {
      return scenes
        .map((scene) =>
          [
            scene.title,
            scene.role || scene.purpose,
            typeof scene.duration_seconds === "number"
              ? `${scene.duration_seconds} 秒`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("；");
    }
    return typeof projection.scene_count === "number"
      ? `${projection.scene_count} 个分镜已确定`
      : "结构已确定";
  }
  if (
    result.stage === "scene_direction" ||
    result.stage === "grounding_review"
  ) {
    return [projection.title, projection.narration || projection.visual_brief]
      .filter(Boolean)
      .join(" · ");
  }
  if (result.stage === "base_draft") {
    return projection.title || projection.body_preview || "初步内容已保存";
  }
  if (result.stage === "creative_profile") {
    return [
      projection.content_goal,
      projection.style_profile,
      projection.production_mode,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (result.stage === "topic_alignment") {
    return typeof projection.scene_count === "number"
      ? `${projection.scene_count} 个分镜已完成整体校对`
      : "整体内容已校对";
  }
  return projection.title || "结果已保存";
}

function GenerationCheckpointSummary({
  job,
}: {
  job: AssetGenerationJobResponse;
}) {
  const results = (job.intermediate_results ?? [])
    .map((result) => ({
      key: `${result.stage}:${result.scene_id ?? "global"}`,
      label: checkpointStageLabel(result.stage),
      detail: intermediateResultDetail(result),
    }))
    .filter((result) => result.detail);
  const reusedCount = job.checkpoint_resume?.reused_stages?.length ?? 0;
  const rerunSceneCount = job.checkpoint_resume?.rerun_scene_ids?.length ?? 0;
  const boundary = job.checkpoint_resume?.invalidation_boundary;
  if (results.length === 0 && reusedCount === 0 && rerunSceneCount === 0)
    return null;

  const resumeMessage =
    reusedCount > 0
      ? `已复用 ${reusedCount} 个已完成阶段${
          boundary ? `，将从${checkpointStageLabel(boundary)}继续。` : "。"
        }`
      : null;

  return (
    <section className="shadcn-prototype-agent-run" aria-label="生成中结果">
      <div className="shadcn-prototype-agent-run-head">
        <span className="shadcn-prototype-agent-run-title">生成中结果</span>
        {results.length > 0 ? (
          <span className="shadcn-prototype-agent-run-count">
            {results.length} 项已保存
          </span>
        ) : null}
      </div>
      <ol className="shadcn-prototype-agent-run-steps">
        {results.map((result) => (
          <li key={result.key} className="shadcn-prototype-agent-run-step done">
            <span className="shadcn-prototype-agent-run-ic" aria-hidden="true">
              ✓
            </span>
            <span className="shadcn-prototype-agent-run-tx">
              <strong>{result.label}</strong>
              <span>{result.detail}</span>
            </span>
            <span className="shadcn-prototype-agent-run-tm">已保存</span>
          </li>
        ))}
        {resumeMessage ? (
          <li className="shadcn-prototype-agent-run-step done">
            <span className="shadcn-prototype-agent-run-ic" aria-hidden="true">
              ↻
            </span>
            <span className="shadcn-prototype-agent-run-tx">
              {resumeMessage}
            </span>
            <span className="shadcn-prototype-agent-run-tm">已恢复</span>
          </li>
        ) : null}
        {rerunSceneCount > 0 ? (
          <li className="shadcn-prototype-agent-run-step wait">
            <span className="shadcn-prototype-agent-run-ic" aria-hidden="true">
              •
            </span>
            <span className="shadcn-prototype-agent-run-tx">
              {`将重新处理 ${rerunSceneCount} 个分镜。`}
            </span>
            <span className="shadcn-prototype-agent-run-tm">待继续</span>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

export function AssetGenerationJobCard({
  job,
  onRetry,
  onCancel,
  completionLabel,
  boundContentType,
  connectionLost = false,
}: {
  job: AssetGenerationJobResponse;
  onRetry?: (jobId: string) => void | Promise<void>;
  onCancel?: (jobId: string) => void | Promise<void>;
  completionLabel?: string;
  boundContentType?: string;
  connectionLost?: boolean;
}) {
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const canCancel = job.status === "queued" || job.status === "running";
  const canRetryFailedJob = job.status === "failed" && job.retryable === true;
  const canRegenerateFailedJob =
    job.status === "failed" && job.regenerable === true;
  const terminal = job.status === "completed" || job.status === "cancelled";
  const steps = generationTimelineSteps(job, now);
  const failedStageLabel = job.failure_context?.stage
    ? steps.find((step) => step.key === job.failure_context?.stage)?.label
    : undefined;
  const progressKind = resolveProgressKind({
    progressKind: job.progress_kind,
    boundContentType,
    steps,
  });

  useEffect(() => {
    if (!canCancel) setStopping(false);
  }, [canCancel, job.status]);
  useEffect(() => {
    if (job.status !== "failed" && job.status !== "cancelled")
      setRetrying(false);
  }, [job.status]);
  useEffect(() => {
    if (job.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.status]);

  const stop = async () => {
    if (!onCancel || stopping) return;
    setStopping(true);
    try {
      await onCancel(job.id);
    } catch {
      setStopping(false);
    }
  };
  const retry = async (jobId: string) => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry(jobId);
    } catch {
      setRetrying(false);
    }
  };
  const retryStopped = () => {
    if (job.status === "cancelled") void retry(job.id);
  };
  const isDirectorScriptGeneration =
    generationTimelineTitle(job) === "编导稿生成进度";

  if (progressKind !== "general") {
    return (
      <div
        className="shadcn-prototype-generation-job-timeline"
        data-generation-job-id={job.id}
      >
        <VideoProgressCard
          kind={progressKind}
          status={job.status}
          steps={steps}
          submitted={Boolean(job.id)}
          completionConfirmed={job.status === "completed" && !connectionLost}
          completionLabel={completionLabel}
          connectionLost={connectionLost}
          errorMessage={job.status === "failed" ? failureMessage(job) : null}
          failureContext={
            job.status === "failed" &&
            (failedStageLabel ||
              job.failure_context?.reusable_result?.asset_id) ? (
              <>
                {failedStageLabel ? <p>失败阶段：{failedStageLabel}</p> : null}
                {job.failure_context?.reusable_result?.asset_id ? (
                  <p>已保留可继续使用的中间结果。</p>
                ) : null}
              </>
            ) : null
          }
          sceneProgress={job.scene_progress}
          providerWaitLabel={
            generationProviderWaitLabel(job.provider_wait, now) ?? undefined
          }
          actions={
            canCancel && onCancel ? (
              <button
                type="button"
                className="shadcn-prototype-agent-run-stop"
                disabled={stopping}
                onClick={() => void stop()}
              >
                {stopping ? "正在停止…" : "停止生成"}
              </button>
            ) : (canRetryFailedJob ||
                canRegenerateFailedJob ||
                job.status === "cancelled") &&
              onRetry ? (
              <button
                type="button"
                className="shadcn-prototype-agent-run-retry"
                disabled={retrying}
                onClick={() => void retry(job.id)}
              >
                {retrying
                  ? "正在重试…"
                  : job.status === "cancelled" || canRegenerateFailedJob
                    ? "重新生成"
                    : "重试"}
              </button>
            ) : null
          }
        />
        <GenerationCheckpointSummary job={job} />
      </div>
    );
  }

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
        onRetry={
          (canRetryFailedJob || canRegenerateFailedJob) && onRetry
            ? (jobId) => {
                void retry(jobId);
              }
            : undefined
        }
        retrying={retrying}
        completionConfirmed={terminal}
        completionLabel={
          completionLabel ??
          (isDirectorScriptGeneration
            ? "编导脚本已生成，可确认或修改"
            : "内容已生成，可查看")
        }
        footer={
          canCancel && onCancel ? (
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
          ) : null
        }
      />
      <GenerationCheckpointSummary job={job} />
    </div>
  );
}
