// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import StoryboardPreview from "../components/storyboard-preview";
import type { ProductArtifact } from "../lib/asset-workspace-shared";

afterEach(cleanup);

const baseProduct: ProductArtifact = {
  id: "video-visual-anchor",
  mode: "video",
  title: "产品介绍视频",
  status: "视频工程",
  summary: "",
  ratio: "16:9",
  duration: "8 秒",
  phase: "视频工程",
  sections: [],
  timeline: [],
  actions: [],
};

describe("storyboard light preview", () => {
  it("shows a graphics-primary visual anchor instead of a missing-material placeholder", () => {
    render(
      <StoryboardPreview
        product={{
          ...baseProduct,
          segments: [{
            id: "graphic-scene",
            index: 1,
            title: "品牌收束",
            line: "现在开始制作你的内容。",
            isFallback: false,
            primaryVisualTreatment: "graphics_primary",
            visualTreatmentLabel: "图形主画面",
            graphicComponentLabel: "品牌收束",
            backgroundTreatmentLabel: "已验证素材虚化背景",
          }],
        }}
        activeSegmentId="graphic-scene"
      />,
    );

    expect(screen.getByLabelText("图形主画面预览")).toBeInTheDocument();
    expect(screen.getAllByText("品牌收束")).toHaveLength(1);
    expect(screen.getByText("图形主画面")).toBeInTheDocument();
    expect(screen.queryByText("待补素材")).not.toBeInTheDocument();
  });

  it("keeps an actually unfilled source scene in the missing-material state", () => {
    render(
      <StoryboardPreview
        product={{
          ...baseProduct,
          segments: [{
            id: "missing-scene",
            index: 2,
            title: "案例画面",
            line: "展示真实案例。",
            isFallback: true,
            materialFillStatus: "unfilled",
          }],
        }}
        activeSegmentId="missing-scene"
      />,
    );

    expect(screen.getByText("待补素材")).toBeInTheDocument();
    expect(screen.queryByLabelText("图形主画面预览")).not.toBeInTheDocument();
  });
});
