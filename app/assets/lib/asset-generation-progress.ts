import type { AssetGenerationJobResponse } from "../../../lib/api";

export type GenerationProgressEvent = NonNullable<AssetGenerationJobResponse["progress_events"]>[number];

export function generationElapsedLabel(job: Pick<AssetGenerationJobResponse, "created_at" | "started_at" | "status">, now = Date.now()): string | null {
  if (job.status !== "running") return null;
  const started = Date.parse(job.started_at || job.created_at);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `已耗时 ${seconds} 秒`;
  return `已耗时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
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
  return [{ key: job.status, label, detail: "", status: job.status === "running" || job.status === "queued" ? "active" : "completed", occurred_at: job.updated_at }];
}

export function generationTerminalSummary(job: AssetGenerationJobResponse): string {
  if (job.status === "completed") return "内容生成已完成 · 查看过程";
  if (job.status === "cancelled") return "内容生成已停止 · 查看过程";
  return "内容生成失败";
}
