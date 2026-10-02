import type { AgentRunStep } from "./asset-workspace-types";

export type VideoProgressKind = "video_plan" | "video_create" | "video_update";
export type ProgressKind = VideoProgressKind | "general";
export function resolveProgressKind(input: {
  progressKind?: unknown;
  boundContentType?: string;
  operation?: string;
  steps?: readonly Pick<AgentRunStep, "key">[];
}): ProgressKind {
  if (input.progressKind === "general" || input.progressKind === "video_plan"
    || input.progressKind === "video_create" || input.progressKind === "video_update") {
    return input.progressKind;
  }
  if (input.boundContentType === "video_script" || input.boundContentType === "short_video_narration") {
    return "video_plan";
  }
  if (input.boundContentType === "video_project") {
    return input.operation === "revise" ? "video_update" : "video_create";
  }
  if (input.steps?.some((step) => step.key === "source_fact_contract"
    || step.key === "structuring_director_script"
    || step.key === "scene_direction" || step.key === "global_choreography")) {
    return "video_plan";
  }
  return "general";
}

export type VideoProgressStatus =
  | "submitting" | "queued" | "running" | "completed" | "failed" | "cancelled";

export type VideoProgressInput = {
  kind: VideoProgressKind;
  status: VideoProgressStatus;
  steps: AgentRunStep[];
  submitted: boolean;
  completionConfirmed?: boolean;
  connectionLost?: boolean;
  providerWaitLabel?: string;
};

export type VideoProgressMilestone = {
  key: string;
  label: string;
  status: "done" | "run" | "fail" | "stopped";
};

const COPY = {
  video_plan: {
    running: "正在准备视频方案", completed: "视频方案已准备好",
    failed: "视频方案未完成", preparation: "整理资料", working: "准备视频方案",
    finished: "方案已准备好", description: "正在根据已确认的需求准备内容。",
  },
  video_create: {
    running: "正在制作视频", completed: "视频已做好",
    failed: "视频制作未完成", preparation: "准备画面", working: "制作视频",
    finished: "视频已做好", description: "视频正在后台制作。",
  },
  video_update: {
    running: "正在修改视频", completed: "视频已更新",
    failed: "本次修改未完成", preparation: "调整内容", working: "调整内容",
    finished: "视频已更新", description: "正在根据本次要求调整视频。",
  },
} as const;

const SUBMISSION_EVENTS = new Set(["queued", "create_job"]);
const TERMINAL_EVENTS = new Set(["completed", "failed", "cancelled", "canceled"]);
const PUBLIC_STAGE_EVENTS = new Set([
  "source_importing", "transcribing", "source_staging", "visual_understanding",
  "audio_analysis", "visual_analysis", "semantic_cleanup", "cleanup_apply",
  "subtitles", "directing", "chaptering", "candidate_ranking", "top_visual_completion",
  "drafting", "structuring_director_script", "video_pipeline_selection",
  "scene_direction", "scene_direction_repair", "grounding_review",
  "grounding_review_repair", "grounding_review_claim_completion",
  "scene_semantic_review", "scene_semantic_repair", "scene_semantic_final_review",
  "source_fact_contract", "creative_profile", "scene_structure", "topic_alignment", "creative_direction",
  "art_direction", "asset_requirements", "primary_visual_strategy",
  "global_choreography", "saving", "prepare_scenes", "prepare_media",
  "build_project", "mg_overlay",
]);

function milestoneStatus(
  current: VideoProgressMilestone["status"] | undefined,
  next: AgentRunStep["status"],
  completed: boolean,
): VideoProgressMilestone["status"] {
  if (completed) return "done";
  if (current === "fail" || next === "fail") return "fail";
  if (current === "run" || next === "run") return "run";
  return "done";
}

export function videoProgressPresentation(input: VideoProgressInput) {
  const { kind, status, submitted, steps } = input;
  const copy = COPY[kind];
  const completed = status === "completed" && input.completionConfirmed === true;
  const failed = status === "failed";
  const stopped = status === "cancelled";
  const milestones: VideoProgressMilestone[] = [];
  if (submitted) {
    milestones.push({ key: "submitted", label: "任务已提交", status: "done" });
  }

  for (const step of submitted ? steps : []) {
    if (step.status === "wait" || SUBMISSION_EVENTS.has(step.key) || TERMINAL_EVENTS.has(step.key)) {
      continue;
    }
    const key = PUBLIC_STAGE_EVENTS.has(step.key) ? step.key : "working";
    const label = PUBLIC_STAGE_EVENTS.has(step.key) ? step.label : copy.working;
    const existing = milestones.find((item) => item.key === key);
    if (existing) {
      existing.status = milestoneStatus(existing.status, step.status, completed);
    } else {
      milestones.push({ key, label, status: milestoneStatus(undefined, step.status, completed) });
    }
  }
  const last = milestones.at(-1);
  if (failed && last && last.key !== "submitted") last.status = "fail";
  if (stopped) {
    for (const item of milestones) {
      if (item.status === "run") item.status = "stopped";
    }
  }
  const running = status === "running" || (status === "completed" && !completed);
  if (running && submitted && !failed && !stopped) {
    if (!milestones.some((item) => item.key !== "submitted")) {
      milestones.push({ key: "working", label: copy.working, status: "run" });
    } else if (!milestones.some((item) => item.status === "run" || item.status === "fail")) {
      // Delivery is still pending even when all currently observed steps ended.
      milestones[milestones.length - 1].status = "run";
    }
  }
  if (completed) {
    milestones.push({ key: "completed", label: copy.finished, status: "done" });
  }

  let title: string = copy.running;
  let description: string = copy.description;
  const tone = completed ? "success" : failed ? "fail" : stopped ? "cancelled" : "running";
  if (completed) {
    title = copy.completed;
    description = "";
  } else if (failed) {
    title = copy.failed;
    description = kind === "video_update"
      ? "请查看原因，按提示继续处理本次修改。" : "请查看原因，按提示继续处理。";
  } else if (stopped) {
    title = "本次任务已停止";
    description = "";
  } else if (input.connectionLost) {
    title = "暂时无法更新进度";
    description = "正在重新连接，以下保留最近一次确认的进展。";
  } else if (status === "submitting" || !submitted) {
    title = "正在提交任务";
    description = "正在确认任务是否已提交。";
  } else {
    const active = steps.find((step) => step.status === "run");
    if (status === "queued") {
      title = "视频任务已提交";
      description = "正在等待开始。你可以先离开本对话，稍后回来查看。";
    } else if (active) {
      title = PUBLIC_STAGE_EVENTS.has(active.key) ? active.label : copy.running;
      description = input.providerWaitLabel ?? active.elapsedLabel ?? "";
    }
  }
  return { title, description, tone, completed, milestones };
}
