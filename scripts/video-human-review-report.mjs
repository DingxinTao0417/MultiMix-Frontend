import fs from "node:fs";
import path from "node:path";

const REVIEW_VERSION = "rendered-human-review:v1";
const sampleFractions = [0.15, 0.5, 0.85];
const rubric = [
  ["truth_and_positioning", "内容可信与产品定位", 20],
  ["narrative_and_pacing", "叙事结构与节奏", 15],
  ["asset_relevance_and_authenticity", "素材相关性与可信感", 20],
  ["art_direction_and_scene_variety", "美术指导与场景差异", 20],
  ["information_hierarchy_and_readability", "信息分层与可读性", 10],
  ["motion_and_camera_language", "动效与镜头语言", 10],
  ["audio_and_technical_finish", "声音与技术完成度", 5],
];

function requiredText(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function authoritativeSceneWindows(videoProject, videoPlan) {
  const known = new Set((videoPlan?.scenes ?? []).map((scene) => String(scene?.id ?? "")));
  const windows = new Map();
  for (const track of videoProject?.tracks ?? []) {
    if (track?.id !== "track-video") continue;
    for (const element of track?.elements ?? []) {
      const sceneId = String(element?.segmentId ?? "");
      const start = Number(element?.startTime ?? 0);
      const end = start + Number(element?.duration ?? 0);
      if (!known.has(sceneId) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const previous = windows.get(sceneId);
      windows.set(sceneId, {
        scene_id: sceneId,
        start_seconds: previous ? Math.min(previous.start_seconds, start) : start,
        end_seconds: previous ? Math.max(previous.end_seconds, end) : end,
      });
    }
  }
  return [...windows.values()]
    .sort((left, right) => left.start_seconds - right.start_seconds)
    .map((window) => ({
      ...window,
      samples: sampleFractions.map((fraction) => ({
        fraction,
        timestamp_seconds: Number((window.start_seconds + (window.end_seconds - window.start_seconds) * fraction).toFixed(6)),
      })),
    }));
}

function warningLines(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return ["- 本次技术质量门未记录确定性警告；这不等同于人工审片通过。"];
  }
  const grouped = new Map();
  warnings.forEach((warning) => {
    const value = warning && typeof warning === "object" ? warning : {};
    const code = typeof value.code === "string" && value.code.trim() ? value.code.trim() : "unknown_warning";
    const message = typeof value.message === "string" && value.message.trim()
      ? value.message.trim()
      : "未提供具体说明。";
    const key = `${code}\u0000${message}`;
    const previous = grouped.get(key);
    grouped.set(key, previous ? { ...previous, count: previous.count + 1 } : { code, message, count: 1 });
  });
  return [...grouped.values()].map(({ code, message, count }) => (
    `- \`${code}\`：${message}${count > 1 ? `（共 ${count} 次）` : ""}`
  ));
}

export function buildRenderedHumanReview({
  candidateVideo,
  candidateVideoSha256 = null,
  referenceVideo = null,
  referenceVideoSha256 = null,
  videoType,
  creativeDraftOnly,
  qualityWarnings,
  benchmarkBinding = null,
  sameInputAb = null,
  videoPlan = null,
  videoProject = null,
}) {
  const candidate = requiredText(candidateVideo, "candidate video path");
  const type = requiredText(videoType, "video type");
  const binding = benchmarkBinding && typeof benchmarkBinding === "object"
    ? benchmarkBinding
    : { status: "unbound", case_id: null, case_fingerprint: null, input_fingerprint: null };
  const sceneWindows = videoPlan && videoProject
    ? authoritativeSceneWindows(videoProject, videoPlan)
    : [];
  if (binding.status === "bound") {
    if (sceneWindows.length === 0) {
      throw new Error("bound human review requires authoritative scene windows");
    }
    if (binding.candidate_video_sha256 !== candidateVideoSha256) {
      throw new Error("bound human review candidate fingerprint does not match");
    }
  }
  return {
    schema_version: REVIEW_VERSION,
    benchmark: {
      status: binding.status ?? "unbound",
      case_id: binding.case_id ?? null,
      case_fingerprint: binding.case_fingerprint ?? null,
      input_fingerprint: binding.input_fingerprint ?? null,
      benchmark_level: binding.benchmark_level ?? null,
      scenario_family: binding.scenario_family ?? null,
    },
    same_input_ab: sameInputAb ?? { status: "not_provided" },
    candidate: { path: candidate, sha256: candidateVideoSha256 },
    reference: { path: referenceVideo, sha256: referenceVideoSha256 },
    video_type: type,
    creative_draft_only: creativeDraftOnly === true,
    scene_windows: sceneWindows,
    review: {
      status: "pending",
      reviewer: null,
      reviewed_at: null,
      complete_viewing: false,
      dimensions: rubric.map(([id, label, weight]) => ({
        id,
        label,
        weight,
        candidate_score: null,
        reference_score: null,
        evidence: null,
      })),
      findings: [],
      disagreements: [],
      decision: null,
    },
    technical_signals: { quality_warnings: Array.isArray(qualityWarnings) ? qualityWarnings : [] },
    release: {
      rights_status: "unverified",
      public_release_gold: false,
      maximum_eligible_level:
        binding.status === "bound" && candidateVideoSha256
          ? "technical_baseline"
          : "none",
    },
    advisory_only: true,
    runtime_effects: { quality_gate: false, auto_repair: false },
  };
}

function renderStructuredReview(review) {
  if (review?.schema_version !== REVIEW_VERSION) {
    throw new Error(`human review must use ${REVIEW_VERSION}`);
  }
  const boundary = review.creative_draft_only
    ? "创意草稿：可继续编辑和观看，但不能作为公开发布依据。"
    : "技术候选：已完成当前技术检查，但公开发布仍需单独核对授权、事实、素材与人工审片。";
  const scoreRows = review.review.dimensions
    .map((item) => `| ${item.label} | ${item.weight} |  |  |  |`)
    .join("\n");
  const sceneRows = review.scene_windows
    .map((window) => `| ${window.scene_id} | ${window.start_seconds.toFixed(3)}–${window.end_seconds.toFixed(3)} | ${window.samples.map((sample) => sample.timestamp_seconds.toFixed(3)).join(" / ")} |`)
    .join("\n");

  return [
    "# MultiMix 成片人工评分",
    "",
    `- 案例：${review.benchmark.case_id ?? "unbound"}`,
    `- 候选 MP4：${review.candidate.path}`,
    `- 视频类型：${review.video_type}`,
    `- 人工审片状态：${review.review.status}`,
    `- 交付边界：${boundary}`,
    `- 公开发布 Gold：${review.release.public_release_gold ? "可宣称" : "不可宣称"}`,
    `- 同输入 A/B：${review.same_input_ab?.status ?? "not_provided"}`,
    "- 本表是 `rendered-human-review.json` 的投影；主观判断不改变运行时质量门，也不会触发自动返修。",
    "",
    "## 权威分镜取证窗口",
    "",
    "每镜按窗口内 15% / 50% / 85% 取证。",
    "",
    "| 分镜 | 权威窗口（秒） | 抽样时间（秒） |",
    "| --- | ---: | --- |",
    sceneRows || "| 待生成 |  |  |",
    "",
    "## 已知技术信号",
    "",
    ...warningLines(review.technical_signals.quality_warnings),
    "",
    "## 人工评分",
    "",
    "- 完整观看：- [ ] 已从头到尾观看候选成片",
    "- 每项按 1–5 分填写；加权分 = 分数 × 权重 ÷ 5，总分满分为 100。",
    "- 人工判断参考：建议 85/100，前六项均不低于 4/5，且没有未处理 P0/P1；这不是系统自动通过规则。",
    "- 总分、P0/P1 和结论由审片人决定，不能由本表自动推导。",
    "",
    "| 维度 | 权重 | 候选分数（1–5） | 参考分数（1–5） | 证据 / 问题 |",
    "| --- | ---: | ---: | ---: | --- |",
    scoreRows,
    "| 总分 | 100 |  |  |  |",
    "",
    "## P0/P1 问题",
    "",
    "- [ ] 无 P0/P1 问题",
    "- 记录：",
    "",
  ].join("\n");
}

export function buildVideoHumanReviewReport(input) {
  return renderStructuredReview(
    input?.schema_version === REVIEW_VERSION ? input : buildRenderedHumanReview(input),
  );
}

export function writeVideoHumanReviewReport({ resultDir, ...input }) {
  const outputDirectory = requiredText(resultDir, "result directory");
  const candidate = requiredText(input.candidateVideo, "candidate video path");
  if (!fs.existsSync(candidate)) throw new Error(`candidate video does not exist: ${candidate}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const review = buildRenderedHumanReview(input);
  const jsonPath = path.join(outputDirectory, "rendered-human-review.json");
  const markdownPath = path.join(outputDirectory, "human-review.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderStructuredReview(review), "utf8");
  return markdownPath;
}
