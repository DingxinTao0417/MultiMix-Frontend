import assert from "node:assert/strict";
import test from "node:test";

import { buildVideoHumanReviewReport } from "../video-human-review-report.mjs";

test("human review report keeps the candidate pending and separates public release", () => {
  const report = buildVideoHumanReviewReport({
    candidateVideo: "C:/tmp/candidate.mp4",
    videoType: "explainer",
    creativeDraftOnly: true,
    qualityWarnings: [{
      code: "primary_visual_reuse",
      message: "多个分镜使用了完全相同的主画面。",
    }],
  });

  assert.match(report, /候选 MP4：C:\/tmp\/candidate\.mp4/);
  assert.match(report, /人工审片状态：pending/);
  assert.match(report, /创意草稿/);
  assert.match(report, /不能作为公开发布依据/);
  assert.match(report, /primary_visual_reuse/);
  assert.match(report, /## 人工评分/);
  assert.match(report, /## P0\/P1 问题/);
  assert.match(report, /完整观看：- \[ \]/);
  assert.match(report, /分数 × 权重 ÷ 5/);
  assert.match(report, /建议 85\/100/);
  assert.match(report, /前六项均不低于 4\/5/);
  assert.match(report, /\| 总分 \| 100 \|/);
  assert.doesNotMatch(report, /已通过公开发布/);
});

test("human review report requires an actual candidate path", () => {
  assert.throws(
    () => buildVideoHumanReviewReport({
      candidateVideo: "",
      videoType: "presenter",
      creativeDraftOnly: false,
      qualityWarnings: [],
    }),
    /candidate video path/i,
  );
});

test("human review report groups repeated technical warnings", () => {
  const report = buildVideoHumanReviewReport({
    candidateVideo: "C:/tmp/candidate.mp4",
    videoType: "explainer",
    creativeDraftOnly: false,
    qualityWarnings: [
      { code: "primary_visual_reuse", message: "多个分镜使用了完全相同的主画面。" },
      { code: "primary_visual_reuse", message: "多个分镜使用了完全相同的主画面。" },
    ],
  });

  assert.match(report, /primary_visual_reuse.*共 2 次/);
  assert.equal((report.match(/primary_visual_reuse/g) ?? []).length, 1);
});
