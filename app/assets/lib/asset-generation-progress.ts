import type { AssetGenerationJobResponse } from "../../../lib/api";
import type { AgentRunStep } from "./asset-workspace-types";

export type GenerationProgressEvent = NonNullable<AssetGenerationJobResponse["progress_events"]>[number];

function elapsedLabelFrom(startedAt: string | undefined, now: number): string | null {
  const started = Date.parse(startedAt ?? "");
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `已耗时 ${seconds} 秒`;
  return `已耗时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function generationElapsedLabel(job: Pick<AssetGenerationJobResponse, "created_at" | "started_at" | "status">, now = Date.now()): string | null {
  if (job.status !== "running") return null;
  return elapsedLabelFrom(job.started_at || job.created_at, now);
}

function secondsLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function generationProviderWaitLabel(
  wait: AssetGenerationJobResponse["provider_wait"],
  now = Date.now(),
): string | null {
  if (!wait) return null;
  const requestedAt = Date.parse(wait.request_sent_at);
  if (!Number.isFinite(requestedAt)) return null;
  const elapsedSeconds = Math.max(0, Math.floor((now - requestedAt) / 1000));
  const state = wait.status === "requested"
    ? "模型服务请求已发出，尚未收到首个响应"
    : wait.status === "delayed"
      ? "模型服务响应慢"
      : "模型服务已开始响应";
  const idleTimeout = wait.idle_timeout_seconds;
  const safetyTimeout = wait.safety_timeout_seconds;
  if (
    Number.isFinite(idleTimeout)
    && Number(idleTimeout) > 0
    && Number.isFinite(safetyTimeout)
    && Number(safetyTimeout) > 0
  ) {
    const activityAt = Date.parse(wait.last_response_at || wait.request_sent_at);
    const idleElapsedSeconds = Number.isFinite(activityAt)
      ? Math.max(0, Math.floor((now - activityAt) / 1000))
      : elapsedSeconds;
    const idleRemainingSeconds = Math.max(0, Math.ceil(Number(idleTimeout) - idleElapsedSeconds));
    const safetyRemainingSeconds = Math.max(0, Math.ceil(Number(safetyTimeout) - elapsedSeconds));
    const activityLabel = wait.status === "requested"
      ? `首响应等待剩余 ${secondsLabel(idleRemainingSeconds)}`
      : `最近响应 ${secondsLabel(idleElapsedSeconds)}前 · 停滞保护剩余 ${secondsLabel(idleRemainingSeconds)}`;
    return `${state} · 已等待 ${secondsLabel(elapsedSeconds)} · ${activityLabel} · 安全上限剩余 ${secondsLabel(safetyRemainingSeconds)}`;
  }
  if (!Number.isFinite(wait.budget_seconds) || Number(wait.budget_seconds) <= 0) return null;
  const remainingSeconds = Math.max(0, Math.ceil(Number(wait.budget_seconds) - elapsedSeconds));
  return `${state} · 已等待 ${secondsLabel(elapsedSeconds)} · 本阶段剩余 ${secondsLabel(remainingSeconds)}`;
}

export function generationProgressEvents(job: AssetGenerationJobResponse): GenerationProgressEvent[] {
  const savedEvents = Array.isArray(job.progress_events) ? job.progress_events : [];
  const events = savedEvents.flatMap((event) => {
    if (
      !event
      || typeof event !== "object"
      || typeof event.key !== "string"
      || typeof event.label !== "string"
      || typeof event.status !== "string"
      || typeof event.occurred_at !== "string"
    ) {
      return [];
    }
    return [{ ...event, detail: typeof event.detail === "string" ? event.detail : "" }];
  });
  if (events.length) return events;
  const label = job.status === "queued" ? "内容生成已排队" : job.status === "running" ? "正在生成内容" : job.status === "completed" ? "内容生成已完成" : job.status === "cancelled" ? "本次生成已停止" : "内容生成失败";
  const terminalStatus: "active" | "completed" = job.status === "running" || job.status === "queued"
    ? "active"
    : "completed";
  const terminalEvent = {
    key: job.status,
    label,
    detail: "",
    status: terminalStatus,
    occurred_at: job.updated_at,
  };
  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
    return [
      {
        key: "queued",
        label: "内容生成已排队",
        detail: "",
        status: "completed",
        occurred_at: job.created_at,
      },
      terminalEvent,
    ];
  }
  return [terminalEvent];
}

export function generationTerminalSummary(job: AssetGenerationJobResponse): string {
  if (job.status === "completed") return "内容生成已完成 · 查看过程";
  if (job.status === "cancelled") return "内容生成已停止 · 查看过程";
  return "内容生成失败";
}

function timestamp(value: string | undefined): number | null {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedSeconds(from: string, to: string | undefined): number | undefined {
  const startedAt = timestamp(from);
  const endedAt = timestamp(to);
  if (startedAt === null || endedAt === null || endedAt <= startedAt) return undefined;
  return Math.floor((endedAt - startedAt) / 1000);
}

export function generationTimelineTitle(job: AssetGenerationJobResponse): string {
  return generationProgressEvents(job).some((event) => event.key === "structuring_director_script")
    ? "编导稿生成进度"
    : "内容生成进度";
}

export function generationTimelineSteps(
  job: AssetGenerationJobResponse,
  now = Date.now(),
): AgentRunStep[] {
  const events = generationProgressEvents(job);
  const terminal = job.status === "completed" || job.status === "cancelled";
  return events.map((event, index) => {
    const isLast = index === events.length - 1;
    const failed = job.status === "failed" && (event.key === "failed" || isLast);
    const running = !terminal && !failed && event.status === "active";
    const nextTimestamp = events[index + 1]?.occurred_at
      ?? (running ? new Date(now).toISOString() : undefined);
    return {
      key: event.key,
      label: event.key === "source_staging" && event.detail ? event.detail : event.label,
      status: failed ? "fail" : running ? "run" : "done",
      elapsedSeconds: elapsedSeconds(event.occurred_at, nextTimestamp),
      elapsedLabel: running ? elapsedLabelFrom(event.occurred_at, now) ?? undefined : undefined,
      retryJobId: failed ? job.id : undefined,
    };
  });
}
