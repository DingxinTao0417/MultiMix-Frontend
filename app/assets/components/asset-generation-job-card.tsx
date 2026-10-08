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

function GenerationCostSummary({ visual, image, llm }: {
  visual: AssetGenerationJobResponse["visual_cost_summary"];
  image: AssetGenerationJobResponse["image_cost_summary"];
  llm: AssetGenerationJobResponse["llm_cost_summary"];
}) {
  return (
    <section aria-label="费用统计" className="shadcn-prototype-generation-cost-summary">
      <strong>费用统计</strong>
      {visual ? (
        <>
          <p>素材视觉分析标准价估算：¥{visual.known_standard_cost_cny}</p>
          <p>已计价 {visual.priced_call_count} 次，{visual.unpriced_call_count} 次用量未知；
            输入 {visual.known_prompt_tokens.toLocaleString()}、输出 {visual.known_completion_tokens.toLocaleString()} tokens。</p>
        </>
      ) : null}
      {llm ? (
        <>
          <p>编导/文本模型标准价估算：¥{llm.known_standard_cost_cny}</p>
          <p>已计价 {llm.priced_call_count} 次，{llm.unpriced_call_count} 次费用未知；
            输入 {llm.known_prompt_tokens.toLocaleString()}、输出 {llm.known_completion_tokens.toLocaleString()} tokens。</p>
        </>
      ) : null}
      {image ? (
        <>
          {image.reserved_usd !== null ? <p>FLUX 参考图生成预留上限：${image.reserved_usd}（不是已消费金额）</p> : null}
          {image.executed_call_count > 0 ? (
            <>
              <p>FLUX 参考图已执行估算：${image.executed_estimate_usd}（{image.executed_call_count} 次）</p>
              {image.allocated_call_count > 0 ? (
                <p>FLUX 参考图账单分摊：${image.allocated_billed_usd}；仅 {image.allocated_call_count}/{image.executed_call_count} 次有账单分摊。</p>
              ) : <p>FLUX 参考图暂无账单分摊，实付未知。</p>}
            </>
          ) : <p>FLUX 参考图尚无已执行图片费用记录。</p>}
          {image.unpriced_call_count > 0 ? <p>{image.unpriced_call_count} 次图片执行缺少可计价记录。</p> : null}
        </>
      ) : null}
      {visual || image || llm ? (
        <p>模型标准价估算不是实际账单；图片账单分摊也只覆盖已核对的调用。人民币与美元分列，视频生成及渲染等费用未计入，不能据此计算任务总实付。</p>
      ) : <p>暂无可核算记录。历史任务的费用无法准确倒算。</p>}
    </section>
  );
}

export function AssetGenerationJobCard({
  job,
  onRetry,
  onCancel,
  onOpenSourceScene,
  completionLabel,
  boundContentType,
  connectionLost = false,
}: {
  job: AssetGenerationJobResponse;
  onRetry?: (jobId: string) => void | Promise<void>;
  onCancel?: (jobId: string) => void | Promise<void>;
  onOpenSourceScene?: (sourceAssetId: number, sceneId: string) => void;
  completionLabel?: string;
  boundContentType?: string;
  connectionLost?: boolean;
}) {
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const canCancel = job.status === "queued" || job.status === "running";
  const canRetryFailedJob = job.status === "failed" && job.retryable === true;
  const canResumeStoppedJob = job.status === "cancelled" && job.regenerable === true;
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
  const sourceAssetId = job.failure_context?.source_asset_id;
  const sourceSceneIds = job.status === "failed"
    && job.failure_diagnostic?.error_code === "source_choice_required"
    && job.failure_diagnostic.stage === "primary_visual_strategy"
    && Number.isSafeInteger(sourceAssetId)
    && (sourceAssetId ?? 0) > 0
    && onOpenSourceScene
    ? [...new Set(
        (job.failure_diagnostic.scene_ids ?? [job.failure_diagnostic.scene_id])
          .filter((sceneId): sceneId is string => typeof sceneId === "string" && /^scene-[1-9][0-9]*$/.test(sceneId)),
      )].slice(0, 24)
    : [];
  const sourceChoicePanel = sourceSceneIds.length > 0 && sourceAssetId ? (
    <section aria-label="需要选择画面来源" className="shadcn-prototype-generation-source-choice">
      <p>这些镜头的当前画面方式未能表达目标。打开原编导稿，为对应镜头选择生成图片、上传素材或修改创意。</p>
      <div>
        {sourceSceneIds.map((sceneId) => (
          <button key={sceneId} type="button" onClick={() => onOpenSourceScene?.(sourceAssetId, sceneId)}>
            查看第 {sceneId.slice(6)} 镜并选择画面
          </button>
        ))}
      </div>
    </section>
  ) : null;

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
                canResumeStoppedJob) &&
              onRetry ? (
              <button
                type="button"
                className="shadcn-prototype-agent-run-retry"
                disabled={retrying}
                onClick={() => void retry(job.id)}
              >
                {retrying
                  ? "正在重试…"
                  : canResumeStoppedJob ? "继续生成" : canRegenerateFailedJob
                    ? "重新生成"
                    : "重试"}
              </button>
            ) : null
          }
        />
        <GenerationCostSummary visual={job.visual_cost_summary} image={job.image_cost_summary} llm={job.llm_cost_summary} />
        <GenerationCheckpointSummary job={job} />
        {sourceChoicePanel}
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
          ) : canResumeStoppedJob && onRetry ? (
            <button
              type="button"
              className="shadcn-prototype-agent-run-retry"
              disabled={retrying}
              onClick={retryStopped}
            >
              {retrying ? "正在恢复…" : "继续生成"}
            </button>
          ) : null
        }
      />
      <GenerationCostSummary visual={job.visual_cost_summary} image={job.image_cost_summary} llm={job.llm_cost_summary} />
      <GenerationCheckpointSummary job={job} />
      {sourceChoicePanel}
    </div>
  );
}
