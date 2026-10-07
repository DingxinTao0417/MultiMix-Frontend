// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SegmentCards from "../components/segment-cards";
import type { AssetProductSegment } from "../lib/asset-workspace-types";

describe("visible scene change facts", () => {
  it("shows the goal and camera-only gap without blocking existing scene actions", () => {
    const segment = {
      id: "scene-1", index: 1, title: "倒水", isFallback: false,
      visualChange: {
        goalLabel: "内容动作", startState: "杯子空着", endState: "杯中有水", actions: ["往杯里倒水"],
        methodLabel: "图片（仅镜头运动）", statusLabel: "画面已准备，动作效果待确认",
        notice: "目前只有图片缩放，尚未实现倒水动作。",
      },
    } as AssetProductSegment;
    const onSelect = vi.fn();
    const onReplaceMaterial = vi.fn();
    render(<SegmentCards segments={[segment]} onSelect={onSelect} onReplaceMaterial={onReplaceMaterial} />);
    expect(screen.getByText(/希望看到：内容动作/)).toBeTruthy();
    expect(screen.getByText(/往杯里倒水/)).toBeTruthy();
    expect(screen.getByText(/当前方式：图片（仅镜头运动）/)).toBeTruthy();
    expect(screen.getByText(/画面已准备，动作效果待确认/)).toBeTruthy();
    expect(screen.getByText(segment.visualChange!.notice!)).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "换素材" }));
    expect(onReplaceMaterial).toHaveBeenCalledWith(segment);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("does not manufacture goals or motion warnings for historical scenes", () => {
    render(<SegmentCards segments={[{ id: "old", index: 1, title: "历史分镜", isFallback: false }]} />);
    expect(screen.queryByText(/希望看到|动作效果待确认/)).toBeNull();
  });
});
