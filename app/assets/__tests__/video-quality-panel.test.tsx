// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoQualityPanel from "../components/video-quality-panel";
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
    suggested_actions: ["补齐主轨素材"],
  }],
  warnings: [],
};

describe("VideoQualityPanel", () => {
  it("shows quality findings as export reminders and locates its segment", () => {
    const onLocate = vi.fn();

    render(<VideoQualityPanel report={blockedReport} onLocate={onLocate} />);

    expect(screen.getByRole("status", { name: "视频质量检查" })).toHaveTextContent("导出提醒");
    expect(screen.queryByRole("alert", { name: "视频质量检查" })).not.toBeInTheDocument();
    expect(screen.getByText("第 1 段主画面缺失")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "定位到第 1 段" }));
    expect(onLocate).toHaveBeenCalledWith("scene-1", "main_track");
  });

  it.each([
    ["subtitle_too_many_lines", "subtitle", "第 2 段字幕超过两行"],
    ["mg_stale", "mg_overlay", "第 2 段 MG 与内容不一致"],
    ["mg_primary_blank", "primary_visual", "第 2 段 MG 主画面已保留空白"],
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
