import fs from "node:fs";
import path from "node:path";

function requiredText(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
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

export function buildVideoHumanReviewReport({
  candidateVideo,
  videoType,
  creativeDraftOnly,
  qualityWarnings,
}) {
  const candidate = requiredText(candidateVideo, "candidate video path");
  const type = requiredText(videoType, "video type");
  const boundary = creativeDraftOnly === true
    ? "创意草稿：可继续编辑和观看，但不能作为公开发布依据。"
    : "技术候选：已完成当前技术检查，但公开发布仍需单独核对授权、事实、素材与人工审片。";
  const scoreRows = [
    ["内容可信与产品定位", 20],
    ["叙事结构与节奏", 15],
    ["素材相关性与可信感", 20],
    ["美术指导与场景差异", 20],
    ["信息分层与可读性", 10],
    ["动效与镜头语言", 10],
    ["声音与技术完成度", 5],
  ].map(([criterion, weight]) => `| ${criterion} | ${weight} |  |  |  |`).join("\n");

  return [
    "# MultiMix 成片人工评分",
    "",
    `- 候选 MP4：${candidate}`,
    `- 视频类型：${type}`,
    "- 人工审片状态：pending",
    `- 交付边界：${boundary}`,
    "- 审片前请查看：`run-manifest.json`、`browser-result.json`、`qa-report.md` 与 `keyframes/`。",
    "",
    "## 已知技术信号",
    "",
    ...warningLines(qualityWarnings),
    "",
    "## 人工评分",
    "",
    "- 完整观看：- [ ] 已从头到尾观看候选成片",
    "- 每项按 1–5 分填写；加权分 = 分数 × 权重 ÷ 5，总分满分为 100。",
    "- 人工判断参考：建议 85/100，前六项均不低于 4/5，且没有未处理 P0/P1；这不是系统自动通过规则。",
    "- 总分、P0/P1 和结论由审片人决定，不能由本表自动推导。",
    "",
    "| 维度 | 权重 | 分数（1–5） | 加权分 | 证据 / 问题 |",
    "| --- | ---: | ---: | ---: | --- |",
    scoreRows,
    "| 总分 | 100 |  |  |  |",
    "",
    "## P0/P1 问题",
    "",
    "- [ ] 无 P0/P1 问题",
    "- [ ] P0：阻塞观看、事实、授权或成片可用性",
    "- [ ] P1：明显影响理解、可信度、节奏、字幕或素材匹配",
    "- 记录（时间点、证据、处理结论）：",
    "",
    "## 审片结论",
    "",
    "- [ ] 技术候选可保留，继续编辑",
    "- [ ] 需要按 P0/P1 修复后重审",
    "- [ ] 已完成公开发布前置条件核对（授权、产品事实、互补素材、人工审片）",
    "",
  ].join("\n");
}

export function writeVideoHumanReviewReport({ resultDir, ...input }) {
  const directory = requiredText(resultDir, "result directory");
  const candidate = requiredText(input.candidateVideo, "candidate video path");
  if (!fs.existsSync(candidate)) {
    throw new Error(`candidate video is missing: ${candidate}`);
  }
  fs.mkdirSync(directory, { recursive: true });
  const reportPath = path.join(directory, "human-review.md");
  fs.writeFileSync(reportPath, buildVideoHumanReviewReport(input), "utf8");
  return reportPath;
}
