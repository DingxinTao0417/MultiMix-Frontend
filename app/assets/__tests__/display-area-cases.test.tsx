// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProductPreview from "../components/product-preview";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWorkspace(caseId: keyof typeof displayProducts) {
  const product = displayProducts[caseId];
  return render(
    <ProductWorkspace
      copied={false}
      onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)}
      onRetryVideoJob={vi.fn(async () => undefined)}
      product={product}
      selectedConversation={conversationForDisplayProduct(product)}
    />,
  );
}

describe("display-area eight-case matrix", () => {
  it("renders a director script as continuous text without video chrome", () => {
    render(<ProductPreview product={{
      ...displayProducts["case-01-director-draft"],
      mode: "copy",
      markdownBody: "# 编导稿\n\n连续文字正文",
    }} />);

    expect(screen.getByRole("article")).toHaveTextContent("连续文字正文");
    expect(screen.queryByLabelText(/视频工程预览|成片播放/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("分镜摘要")).not.toBeInTheDocument();
  });

  it.each([
    ["case-01-director-draft", "编导稿草稿"],
    ["case-02-saved-asset-match", "已引用 测试门店素材"],
    ["case-03-no-asset-hit", "未命中素材"],
    ["case-08-mg-failed-project-ready", "MG 渲染失败，原分镜仍保留"],
  ] as const)("renders %s truthfully", (caseId, expectedText) => {
    render(<ProductPreview product={displayProducts[caseId]} />);
    expect(screen.getAllByText(expectedText, { exact: false }).length).toBeGreaterThan(0);
  });

  it("labels the no-MP4 project as a single storyboard preview", () => {
    render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(screen.getByLabelText("轻量分镜预览")).toBeInTheDocument();
    expect(screen.queryByText("分镜预览 · #1")).not.toBeInTheDocument();
    expect(screen.getByText("分镜 1")).toBeInTheDocument();
    expect(screen.queryByLabelText("成片预览")).not.toBeInTheDocument();
    expect(screen.queryByTitle("视频工程只读预览")).not.toBeInTheDocument();
  });

  it("uses the shared player for a playable finished video", () => {
    render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "点击画面播放视频" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "调整视频预览高度" })).not.toBeInTheDocument();
  });

  it("seeks the finished video when a storyboard card is selected", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    const video = container.querySelector("video")!;

    fireEvent.click(screen.getByRole("button", { name: /#2.*服务过程/s }));

    expect(video.currentTime).toBe(1.5);
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /#2.*服务过程/s })).toHaveClass("active");
  });

  it("updates the active storyboard from finished-video playback time", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    const video = container.querySelector("video")!;

    video.currentTime = 2;
    fireEvent.timeUpdate(video);

    expect(screen.getByRole("button", { name: /#2.*服务过程/s })).toHaveClass("active");
  });

  it("switches only the selected storyboard when no finished video exists", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);

    fireEvent.click(screen.getByRole("button", { name: /#2.*服务过程/s }));

    expect(screen.queryByText("分镜预览 · #2")).not.toBeInTheDocument();
    expect(screen.getByText("分镜 2")).toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /#2.*服务过程/s })).toHaveClass("active");
  });

  it("switches a failed full video to a recoverable storyboard preview", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);

    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("成片加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试成片" }));
    expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
  });

  it("shows a real saved-asset thumbnail without calling it fallback material", () => {
    render(<ProductPreview product={displayProducts["case-02-saved-asset-match"]} />);
    expect(screen.getByText("已引用 测试门店素材", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("你的素材", { exact: false })).not.toBeInTheDocument();
  });

  it("keeps a running project out of edit and export", () => {
    renderWorkspace("case-04-project-running");
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("视频工程生成中"))).toBe(true);
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });

  it("shows a stable failure with retry and no project controls", () => {
    renderWorkspace("case-05-project-failed");
    expect(screen.getByRole("alert")).toHaveTextContent("素材合成步骤失败，请重试");
    expect(screen.getByRole("button", { name: /重试生成/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });

  it.each(["case-06-project-ready-no-mp4", "case-08-mg-failed-project-ready"] as const)(
    "keeps %s editable without pretending an MP4 exists",
    (caseId) => {
      const { container } = renderWorkspace(caseId);
      expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /导出/ })).toBeInTheDocument();
      expect(container.querySelector("iframe.shadcn-prototype-export-bridge")).toBeInTheDocument();
      expect(container.querySelector("video")).not.toBeInTheDocument();
    },
  );

  it("renders a real video element only for the MP4 case", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    expect(container.querySelector("video")).toHaveAttribute("src", expect.stringContaining("display-sample.mp4"));
  });
});
