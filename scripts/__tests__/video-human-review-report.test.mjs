import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRenderedHumanReview,
  buildVideoHumanReviewReport,
  writeVideoHumanReviewReport,
} from "../video-human-review-report.mjs";

test("structured human review is authoritative, scene-window based, and advisory", () => {
  const review = buildRenderedHumanReview({
    candidateVideo: "C:/tmp/candidate.mp4",
    candidateVideoSha256: "d".repeat(64),
    videoType: "explainer",
    creativeDraftOnly: false,
    qualityWarnings: [],
    benchmarkBinding: {
      schema_version: "video-benchmark-run-binding:v1",
      status: "bound",
      case_id: "operation_explainer_v2",
      case_fingerprint: "a".repeat(64),
      input_fingerprint: "b".repeat(64),
      benchmark_level: "technical_baseline",
      scenario_family: "operation_explainer",
      candidate_video_sha256: "d".repeat(64),
    },
    videoPlan: { scenes: [{ id: "scene-1" }, { id: "scene-2" }] },
    videoProject: {
      tracks: [{
        id: "track-video",
        elements: [
          { segmentId: "scene-1", startTime: 2, duration: 4 },
          { segmentId: "scene-2", startTime: 6, duration: 10 },
        ],
      }],
    },
  });

  assert.equal(review.schema_version, "rendered-human-review:v1");
  assert.equal(review.benchmark.status, "bound");
  assert.equal(review.benchmark.benchmark_level, "technical_baseline");
  assert.equal(review.benchmark.scenario_family, "operation_explainer");
  assert.deepEqual(review.same_input_ab, { status: "not_provided" });
  assert.equal(review.review.status, "pending");
  assert.equal(review.review.complete_viewing, false);
  assert.equal(review.release.rights_status, "unverified");
  assert.equal(review.release.maximum_eligible_level, "technical_baseline");
  assert.equal(review.advisory_only, true);
  assert.deepEqual(review.runtime_effects, { quality_gate: false, auto_repair: false });
  assert.deepEqual(
    review.scene_windows[0].samples.map((sample) => sample.timestamp_seconds),
    [2.6, 4, 5.4],
  );
  assert.deepEqual(
    review.scene_windows[1].samples.map((sample) => sample.fraction),
    [0.15, 0.5, 0.85],
  );

  const markdown = buildVideoHumanReviewReport(review);
  assert.match(markdown, /人工审片状态：pending/);
  assert.match(markdown, /scene-1/);
  assert.match(markdown, /15% \/ 50% \/ 85%/);
  assert.match(markdown, /公开发布 Gold：不可宣称/);
});

test("bound review rejects missing authoritative scene windows", () => {
  assert.throws(
    () => buildRenderedHumanReview({
      candidateVideo: "C:/tmp/candidate.mp4",
      candidateVideoSha256: "d".repeat(64),
      videoType: "explainer",
      creativeDraftOnly: false,
      qualityWarnings: [],
      benchmarkBinding: {
        status: "bound",
        case_id: "operation_explainer_v2",
        case_fingerprint: "a".repeat(64),
        input_fingerprint: "b".repeat(64),
        candidate_video_sha256: "d".repeat(64),
      },
    }),
    /authoritative scene windows/i,
  );
});

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

test("writer persists authoritative JSON before its Markdown projection", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-human-review-"));
  try {
    const candidateVideo = path.join(directory, "candidate.mp4");
    fs.writeFileSync(candidateVideo, "candidate-bytes");
    const markdownPath = writeVideoHumanReviewReport({
      resultDir: directory,
      candidateVideo,
      candidateVideoSha256: "d".repeat(64),
      videoType: "presenter",
      creativeDraftOnly: false,
      qualityWarnings: [],
      videoPlan: { scenes: [{ id: "scene-1" }] },
      videoProject: {
        tracks: [{
          id: "track-video",
          elements: [{ segmentId: "scene-1", startTime: 0, duration: 8 }],
        }],
      },
    });

    const jsonPath = path.join(directory, "rendered-human-review.json");
    assert.equal(markdownPath, path.join(directory, "human-review.md"));
    assert.equal(JSON.parse(fs.readFileSync(jsonPath, "utf8")).schema_version, "rendered-human-review:v1");
    assert.match(fs.readFileSync(markdownPath, "utf8"), /本表是 `rendered-human-review\.json` 的投影/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
