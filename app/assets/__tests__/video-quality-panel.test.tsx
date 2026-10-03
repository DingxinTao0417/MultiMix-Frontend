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
    expect(screen.getByRole("status", { name: "视频质量检查" })).toHaveTextContent("必须修复后才能导出");
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

  it("shows export timing failure title and advice without inventing a repair button", () => {
    render(
      <VideoQualityPanel
        report={{
          stage: "export_file",
          status: "blocked",
          blockers: [{
            code: "video_duration_unavailable",
            segment_id: null,
            object_type: "export_file",
            message: "无法从主视频流核对导出画面的结束时间。",
            suggested_actions: ["检查视频轨后重新导出"],
          }],
          warnings: [],
        }}
        onLocate={vi.fn()}
        onRecheck={vi.fn()}
      />,
    );

    expect(screen.getByText("当前工程画面时长无法验证")).toBeVisible();
    expect(screen.getByText("建议：检查视频轨后重新导出")).toBeVisible();
    expect(screen.queryByRole("button", { name: "检查视频轨后重新导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新检查" })).not.toBeInTheDocument();
    expect(screen.getByText("这是导出文件的检查结果，请通过导出菜单重新导出验证。", { exact: true })).toBeVisible();
  });

  it("keeps rechecking available for export preflight findings", () => {
    const onRecheck = vi.fn();
    render(<VideoQualityPanel report={blockedReport} onLocate={vi.fn()} onRecheck={onRecheck} />);
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onRecheck).toHaveBeenCalledOnce();
  });
});
