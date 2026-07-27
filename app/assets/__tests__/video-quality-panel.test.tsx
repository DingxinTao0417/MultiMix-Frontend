// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoQualityPanel, {
  RenderedReviewStatusPanel,
} from "../components/video-quality-panel";
import type { VideoQualityReport } from "../lib/video-quality";

afterEach(cleanup);

const blockedReport: VideoQualityReport = {
  stage: "export_preflight",
  status: "blocked",
  blockers: [{
    code: "main_track_gap",
    segment_id: "scene-1",
    object_type: "main_track",
    message: "主画面在 0.00s–4.47s 存在空档。",
    attempted_fallbacks: ["saved_asset", "stock", "title_card"],
    suggested_actions: ["补齐主轨素材"],
  }],
  warnings: [],
};

describe("VideoQualityPanel", () => {
  it("shows the blocker and locates its segment", () => {
    const onLocate = vi.fn();

    render(<VideoQualityPanel report={blockedReport} onLocate={onLocate} />);

    expect(screen.getByText("第 1 段主画面缺失")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "定位到第 1 段" }));
    expect(onLocate).toHaveBeenCalledWith("scene-1", "main_track");
  });

  it.each([
    ["subtitle_too_many_lines", "subtitle", "第 2 段字幕超过两行"],
    ["mg_stale", "mg_overlay", "第 2 段 MG 与内容不一致"],
  ])("maps %s to a clear label", (code, objectType, label) => {
    render(
      <VideoQualityPanel
        report={{
          ...blockedReport,
          blockers: [{
            ...blockedReport.blockers[0],
            code,
            object_type: objectType,
            segment_id: "scene-2",
          }],
        }}
        onLocate={vi.fn()}
      />,
    );

    expect(screen.getByText(label)).toBeVisible();
  });
});

describe("RenderedReviewStatusPanel", () => {
  it.each([
    ["pending", "正在看片优化"],
    ["reviewing", "正在看片优化"],
    ["stale", "正在看片优化"],
    ["repairing", "正在定点优化问题分镜"],
    ["passed", "画面检查已通过"],
    ["unavailable", "画面检查暂不可用，可稍后重试"],
    ["blocked_requires_user_choice", "检测到手工编辑，需要你确认"],
  ] as const)("shows a truthful %s state", (status, label) => {
    render(
      <RenderedReviewStatusPanel
        review={{
          status,
          project_fingerprint: "a".repeat(64),
          attempt: 1,
          issues: [],
        }}
      />,
    );

    expect(screen.getByText(label)).toBeVisible();
  });

  it("offers an explicit retry only when review is unavailable", () => {
    const onRetry = vi.fn();
    render(
      <RenderedReviewStatusPanel
        review={{
          status: "unavailable",
          project_fingerprint: "a".repeat(64),
          attempt: 1,
          issues: [],
        }}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新检查画面" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the exact blocked scene and plain-language reason", () => {
    render(
      <RenderedReviewStatusPanel
        review={{
          status: "blocked",
          project_fingerprint: "a".repeat(64),
          attempt: 1,
          issues: [{
            code: "duplicate_visible_text",
            scene_id: "scene-2",
            severity: "blocker",
            layer: "subtitle",
            reason: "字幕和中央大字重复。",
            suggested_action: "删掉重复的大字。",
            confidence: 0.96,
          }],
        }}
      />,
    );

    expect(screen.getByText("第 2 段需要调整")).toBeVisible();
    expect(screen.getByText("字幕和中央大字重复。")).toBeVisible();
  });
});
