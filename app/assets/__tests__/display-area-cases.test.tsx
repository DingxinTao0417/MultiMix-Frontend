// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProductPreview from "../components/product-preview";
import ProductWorkspace from "../components/product-workspace";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { VideoQualityReport } from "../lib/video-quality";
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

  it("renders the ready no-MP4 project as a playable engineering preview", () => {
    render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(screen.getByLabelText("视频工程播放器")).toBeInTheDocument();
    expect(screen.getByTitle("视频工程预播").getAttribute("src")).toMatch(
      /^\/editor\?asset=9100&embed=1&mode=preview&previewChannel=.+/,
    );
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(screen.queryByLabelText("成片预览")).not.toBeInTheDocument();
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

  it("seeks and plays the engineering timeline when a segment is selected", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);
    const iframe = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    fireEvent.click(screen.getByRole("button", { name: /#2.*服务过程/s }));

    expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-preview-seek", time: 1.5 },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-preview-play" },
      window.location.origin,
    );
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

  it("shows a generated scene as available media with a non-blocking case hint", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    render(<ProductPreview product={{
      ...base,
      backendAssetId: undefined,
      metadata: {
        ...base.metadata,
        material_gap_notice: "1 个分镜没有找到合适素材，已用字幕/标题卡占位。",
        video_plan: {
          summary: {
            material_unfilled_count: 1,
            material_gap_count: 1,
          },
        },
      },
      segments: [{
        id: "generated-scene",
        index: 1,
        title: "上传流程",
        line: "上传资料后自动生成视频。",
        assetThumbnailUrl: "/display-sample.png",
        isFallback: false,
        primaryVisualSourceType: "generated_scene",
        visualStatusLabel: "已生成画面",
        businessHint: "建议补充真实案例素材",
      }],
    }} />);

    expect(screen.getByLabelText("分镜 #1 视频").querySelector("video")).toHaveAttribute(
      "src",
      "/display-sample.png",
    );
    expect(screen.getByText("已生成画面")).toBeInTheDocument();
    expect(screen.getByText("建议补充真实案例素材")).toBeInTheDocument();
    expect(screen.queryByText("待补素材")).not.toBeInTheDocument();
    expect(screen.queryByText("字幕/标题卡占位", { exact: false })).not.toBeInTheDocument();
  });

  it("prioritizes material-search failure over the generic material-gap notice", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    render(<ProductPreview product={{
      ...base,
      metadata: {
        ...base.metadata,
        material_search_notice: "公共素材搜索暂不可用，2 个分镜已使用标题卡占位，可重试素材匹配。",
        material_gap_notice: "2 个分镜没有找到合适素材。",
      },
    }} />);

    expect(screen.getByText("公共素材搜索暂不可用", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("2 个分镜没有找到合适素材。", { exact: true })).not.toBeInTheDocument();
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

  it("disables export when the backend preflight returns a blocker", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const blocked: VideoQualityReport = {
      stage: "export_preflight",
      status: "blocked",
      blockers: [{
        code: "main_track_gap",
        segment_id: "scene-1",
        object_type: "main_track",
        message: "第 1 段主画面没有覆盖。",
        attempted_fallbacks: ["saved_asset", "title_card"],
        suggested_actions: ["补齐主轨素材"],
      }],
      warnings: [],
    };
    vi.spyOn(assetWorkspaceAdapter, "getVideoQuality").mockResolvedValue(blocked);
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="test-token"
      />,
    );
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-ready" },
    }));

    fireEvent.click(await screen.findByRole("button", { name: "导出视频" }));

    expect(await screen.findByText("第 1 段主画面缺失")).toBeVisible();
    expect(screen.getByRole("button", { name: "导出视频" })).toBeDisabled();
  });

  it("allows warning-only preflight to reach the editor export bridge", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const warningOnly: VideoQualityReport = {
      stage: "export_preflight",
      status: "warning",
      blockers: [],
      warnings: [{
        code: "material_low_confidence",
        segment_id: "scene-1",
        object_type: "material",
        message: "素材相关度偏低。",
        attempted_fallbacks: [],
        suggested_actions: [],
      }],
    };
    vi.spyOn(assetWorkspaceAdapter, "getVideoQuality").mockResolvedValue(warningOnly);
    const { container } = render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="test-token"
      />,
    );
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-ready" },
    }));

    fireEvent.click(await screen.findByRole("button", { name: "导出视频" }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-export" },
      window.location.origin,
    ));
  });

  it("surfaces the exact editor export error instead of a generic retry label", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="test-token"
      />,
    );

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "multimix-editor",
          assetId: product.backendAssetId,
          type: "multimix-editor-ready",
        },
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "multimix-editor",
          assetId: product.backendAssetId,
          type: "multimix-editor-export-error",
          message: "VideoFrames can't be created from tainted sources.",
        },
      }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "VideoFrames can't be created from tainted sources.",
    );
  });

  it("renders fractional editor progress as a percentage", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="test-token"
      />,
    );

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "multimix-editor",
          assetId: product.backendAssetId,
          type: "multimix-editor-ready",
        },
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "multimix-editor",
          assetId: product.backendAssetId,
          type: "multimix-editor-export-progress",
          progress: 0.42,
        },
      }));
    });

    expect(screen.getByRole("button", { name: "导出中 42%" })).toBeDisabled();
  });

  it("requires a fresh user click to download the verified export without rendering again", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    renderWorkspace("case-06-project-ready-no-mp4");

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "multimix-editor",
          assetId: product.backendAssetId,
          type: "multimix-editor-ready",
        },
      }));
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "multimix-editor",
          assetId: product.backendAssetId,
          type: "multimix-editor-export-success",
          report: { stage: "export_output", status: "passed", blockers: [], warnings: [] },
          blob: new Blob(["verified-mp4"], { type: "video/mp4" }),
        },
      }));
    });

    expect(screen.getByRole("button", { name: "下载成片" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "再次导出" })).not.toBeInTheDocument();
  });
});
