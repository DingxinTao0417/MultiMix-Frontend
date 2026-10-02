import { describe, expect, it } from "vitest";
import type { AgentRunStep } from "../lib/asset-workspace-types";
import * as presentation from "../lib/video-progress-presentation";
import type { VideoProgressInput } from "../lib/video-progress-presentation";

function present(overrides: Partial<VideoProgressInput> = {}) {
  return presentation.videoProgressPresentation({
    kind: "video_create", status: "running", steps: [], submitted: true,
    ...overrides,
  });
}
const PUBLIC_LABELS: Record<string, string> = {
  queued: "内容生成已排队",
  source_staging: "正在准备原片",
  transcribing: "正在转写原片",
  visual_analysis: "正在分析人物与动态安全区",
  drafting: "正在生成内容",
  source_fact_contract: "正在核对已确认事实",
  scene_direction: "正在生成分镜导演稿",
  grounding_review: "正在核对分镜事实依据",
  grounding_review_repair: "正在修补分镜事实依据",
  global_choreography: "正在统一安排全片节奏与镜头变化",
  prepare_scenes: "正在准备分镜画面",
  build_project: "正在完成质量检查",
  mg_overlay: "正在生成图形动效",
  completed: "内容生成已完成",
};
const step = (key: string, status: AgentRunStep["status"] = "done"): AgentRunStep => ({
  key, label: PUBLIC_LABELS[key] ?? "内部 Provider / MG / secret", status, elapsedSeconds: 19,
});

describe("video progress scope", () => {
  function resolve(input: Record<string, unknown>) {
    return presentation.resolveProgressKind(input);
  }

  it("uses explicit general scope even when a video is bound", () => {
    expect(resolve({ progressKind: "general", boundContentType: "video_project" })).toBe("general");
  });
  it("uses bound historical script types without parsing labels", () => {
    expect(resolve({ boundContentType: "video_script" })).toBe("video_plan");
    expect(resolve({ boundContentType: "video_project", operation: "revise" })).toBe("video_update");
  });
  it("recognizes a historical director event but does not guess from generic drafting", () => {
    expect(resolve({ steps: [step("structuring_director_script")] })).toBe("video_plan");
    expect(resolve({ steps: [{ ...step("drafting"), label: "正在制作视频" }] })).toBe("general");
    expect(resolve({ progressKind: "future_kind" })).toBe("general");
  });
  it("recognizes the source fact stage as video planning when older jobs omit progressKind", () => {
    expect(resolve({ steps: [step("source_fact_contract", "run")] })).toBe("video_plan");
  });
});

describe("video progress presentation", () => {
  it("shows source fact verification as the active stage", () => {
    const result = present({ kind: "video_plan", steps: [step("source_fact_contract", "run")] });
    expect(result.title).toBe("正在核对已确认事实");
    expect(result.milestones.at(-1)).toMatchObject({
      key: "source_fact_contract", label: "正在核对已确认事实", status: "run",
    });
  });
  it("does not promise background execution before persisted submission", () => {
    const result = present({ status: "submitting", submitted: false, steps: [step("create_job", "run")] });
    expect(result.title).toBe("正在提交任务");
    expect(result.description).not.toMatch(/离开|后台/);
    expect(result.milestones).toEqual([]);
  });

  it("shows a queued task without pretending preparation has started", () => {
    const result = present({ status: "queued", steps: [step("prepare_scenes", "wait")] });
    expect(result.title).toBe("视频任务已提交");
    expect(result.description).toContain("离开");
    expect(result.milestones.map((item) => item.key)).toEqual(["submitted"]);
  });

  it("shows registered public stages without exposing internal timing or labels", () => {
    const result = present({
      kind: "video_plan", status: "completed", completionConfirmed: true,
      steps: ["queued", "source_staging", "transcribing", "visual_analysis",
        "drafting", "scene_direction", "grounding_review", "grounding_review_repair",
        "global_choreography", "completed"].map((key) => step(key)),
    });
    expect(result.milestones.map((item) => item.label)).toEqual([
      "任务已提交",
      "正在准备原片",
      "正在转写原片",
      "正在分析人物与动态安全区",
      "正在生成内容",
      "正在生成分镜导演稿",
      "正在核对分镜事实依据",
      "正在修补分镜事实依据",
      "正在统一安排全片节奏与镜头变化",
      "方案已准备好",
    ]);
    expect(result.title).toBe("视频方案已准备好");
    expect(JSON.stringify(result)).not.toMatch(/Provider|MG|secret|19|第.*步|耗时/);
  });

  it("keeps unknown events generic and hides unstarted phases", () => {
    const result = present({ steps: [step("future_secret", "run"), step("quality_check", "wait")] });
    expect(result.milestones.map((item) => item.label)).toEqual(["任务已提交", "制作视频"]);
    expect(result.milestones.at(-1)?.status).toBe("run");
  });

  it("does not infer completed delivery from completed steps", () => {
    const result = present({
      status: "completed", completionConfirmed: false,
      steps: [step("create_job"), step("build_project")],
    });
    expect(result.completed).toBe(false);
    expect(result.title).toBe("正在制作视频");
    expect(result.milestones.at(-1)?.status).toBe("run");
    expect(result.milestones.some((item) => item.key === "completed")).toBe(false);
  });

  it("keeps required finishing work inside production until confirmed", () => {
    const result = present({ steps: [step("prepare_scenes"), step("build_project"), step("mg_overlay", "run")] });
    expect(result.completed).toBe(false);
    expect(result.milestones.map((item) => item.label)).toEqual([
      "任务已提交", "正在准备分镜画面", "正在完成质量检查", "正在生成图形动效",
    ]);
    expect(result.milestones.at(-1)?.status).toBe("run");
  });

  it("preserves failure even when siblings are running", () => {
    const result = present({
      status: "failed",
      steps: [step("build_project"), { ...step("mg_overlay", "run"), retryJobId: "exact-child" }],
    });
    expect(result.tone).toBe("fail");
    expect(result.milestones.at(-1)?.status).toBe("fail");
    expect(result.completed).toBe(false);
  });

  it("does not reinterpret optional failed steps after authoritative completed delivery", () => {
    const result = present({
      status: "completed", completionConfirmed: true,
      steps: [step("build_project"), step("mg_overlay", "fail")],
    });
    expect(result.completed).toBe(true);
    expect(result.title).toBe("视频已做好");
    expect(result.milestones.some((item) => item.status === "fail")).toBe(false);
  });

  it("describes failed updates without claiming the existing video failed", () => {
    const result = present({ kind: "video_update", status: "failed", steps: [step("action", "fail")] });
    expect(result.title).toBe("本次修改未完成");
    expect(result.description).not.toContain("原视频已损坏");
    expect(result.milestones.map((item) => item.label)).toEqual(["任务已提交", "调整内容"]);
  });

  it("shows cancellation neutrally and never as completion", () => {
    const result = present({ status: "cancelled", completionConfirmed: true, steps: [step("cancelled")] });
    expect(result.title).toBe("本次任务已停止");
    expect(result.tone).toBe("cancelled");
    expect(result.completed).toBe(false);
    expect(result.milestones.map((item) => item.label)).toEqual(["任务已提交"]);
  });

  it("preserves real progress during connection loss and recovers without a new task", () => {
    const steps = [step("prepare_scenes"), step("build_project", "run")];
    const live = present({ steps });
    const disconnected = present({ steps, connectionLost: true });
    expect(disconnected.title).toBe("暂时无法更新进度");
    expect(disconnected.milestones).toEqual(live.milestones);
    expect(disconnected.tone).not.toBe("fail");
    expect(present({ steps, connectionLost: false })).toEqual(live);
  });

  it("keeps authoritative failures visible despite connection loss", () => {
    expect(present({ status: "failed", connectionLost: true }).title).toBe("视频制作未完成");
  });

  it("does not invent historical intermediate phases", () => {
    const result = present({ status: "completed", completionConfirmed: true, steps: [] });
    expect(result.milestones.map((item) => item.key)).toEqual(["submitted", "completed"]);
  });
});
