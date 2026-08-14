// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SegmentCards from "../components/segment-cards";
import type { AssetProductSegment } from "../lib/asset-workspace-types";


describe("presenter segment review", () => {
  it("shows the event arrangement, publish requirement and material gap", () => {
    const segment = {
      id: "scene-1",
      index: 1,
      title: "产品说明",
      line: "先看产品",
      isFallback: false,
      isPresenter: true,
      presenterEvents: [
        {
          id: "event-text",
          type: "text_emphasis",
          label: "文字强调",
          spokenText: "先看",
          purpose: "强调动作",
          statusLabel: "待生成",
          requiredForPublish: false,
        },
        {
          id: "event-takeover",
          type: "media_takeover",
          label: "全屏素材",
          spokenText: "产品",
          purpose: "展示产品",
          statusLabel: "生成失败",
          requiredForPublish: true,
        },
      ],
      presenterMaterialGap: "缺少产品录屏，当前保持人物画面",
    } as AssetProductSegment;

    render(
      <SegmentCards
        segments={[segment]}
        onEditVoiceover={vi.fn()}
        onReplaceMaterial={vi.fn()}
      />,
    );

    expect(screen.getByText(/画面安排：文字强调/).textContent).toContain("先看");
    expect(screen.getByText(/全屏素材/).textContent).toContain("发布必需");
    expect(screen.getByText("素材缺口：缺少产品录屏，当前保持人物画面")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "修改配音" })).toBeNull();
    expect(screen.queryByRole("button", { name: "换素材" })).toBeNull();
  });
});
