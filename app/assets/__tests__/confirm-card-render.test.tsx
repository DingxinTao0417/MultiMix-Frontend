// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConfirmCard from "../components/confirm-card";

describe("ConfirmCard pending state", () => {
  it("does not show the video-project generation explanation", () => {
    render(
      <ConfirmCard
        plan={{
          title: "视频方案",
          status: "pending",
          subtitle: "确认这版方案后生成可编辑视频工程。",
          fields: [{ key: "duration", label: "时长", value: "约 30 秒" }],
        }}
        onConfirm={() => undefined}
        onAdjust={() => undefined}
      />,
    );

    expect(screen.queryByText("确认这版方案后生成可编辑视频工程。")).toBeNull();
  });

  it("hides legacy CTA fields from persisted plans", () => {
    render(
      <ConfirmCard
        plan={{
          title: "视频方案",
          status: "pending",
          fields: [
            { key: "duration", label: "时长", value: "约 30 秒" },
            { key: "cta", label: "结尾引导", value: "预约咨询" },
          ],
        }}
      />,
    );

    expect(screen.getByText("约 30 秒")).toBeTruthy();
    expect(screen.queryByText("结尾引导")).toBeNull();
    expect(screen.queryByText("预约咨询")).toBeNull();
  });

  it("submits the selected ratio and duration for video parameter confirmation", () => {
    const onConfirm = vi.fn();
    const plan = {
      kind: "video_parameter_confirmation" as const,
      title: "确认视频参数",
      status: "pending" as const,
      fields: [
        { key: "ratio", label: "视频比例", value: "横屏 16:9（默认）" },
        { key: "duration", label: "目标时长", value: "30 秒（默认）" },
      ],
      confirmLabel: "确认参数并生成编导稿",
      ratioOptions: [
        { value: "16:9", label: "横屏 16:9" },
        { value: "9:16", label: "竖屏 9:16" },
      ],
      ratioDefault: "16:9",
      durationSeconds: 30,
      durationMin: 5,
      durationMax: 120,
      pendingIntentId: "pending-1",
      pendingIntentVersion: 1,
    };

    render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);

    expect(screen.getByText("横屏 16:9（默认）")).toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "竖屏 9:16" }));
    fireEvent.change(screen.getByLabelText("目标时长（秒）"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, {
      ratio: "9:16",
      targetSeconds: 45,
    });
  });
});
