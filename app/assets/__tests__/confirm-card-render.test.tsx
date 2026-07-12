// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
