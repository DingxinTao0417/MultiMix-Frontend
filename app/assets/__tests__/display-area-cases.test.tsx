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

function previewChannel(frame: HTMLIFrameElement): string {
  return new URL(frame.src, window.location.origin).searchParams.get("previewChannel") ?? "";
}

function dispatchPreviewMessage(
  frame: HTMLIFrameElement,
  assetId: string | number | undefined,
  data: Record<string, unknown>,
) {
  window.dispatchEvent(new MessageEvent("message", {
    origin: window.location.origin,
    data: {
      source: "multimix-editor",
      assetId,
      previewChannel: previewChannel(frame),
      ...data,
    },
  }));
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
    ["case-01-director-draft", "编导脚本"],
    ["case-02-saved-asset-match", "已引用 测试门店素材"],
    ["case-03-no-asset-hit", "未命中素材"],
    ["case-08-mg-failed-project-ready", "第 1 镜动效未能完成"],
  ] as const)("renders %s truthfully", (caseId, expectedText) => {
    render(<ProductPreview product={displayProducts[caseId]} />);
    expect(screen.getAllByText(expectedText, { exact: false }).length).toBeGreaterThan(0);
  });

  it("loads the engineering preview for manual review", () => {
    render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(screen.getByLabelText("视频工程播放器")).toBeInTheDocument();
    expect(screen.getByTitle("视频工程预播").getAttribute("src")).toMatch(
      /^\/editor\?asset=9100&embed=1&mode=preview&previewChannel=.+/,
    );
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(screen.queryByLabelText("成片预览")).not.toBeInTheDocument();
  });

  it("mounts a read-only preview but not the editable iframe during passive browsing", () => {
    renderWorkspace("case-06-project-ready-no-mp4");

    expect(screen.getByTitle("视频工程预播")).toBeInTheDocument();
    expect(screen.queryByTitle("视频剪辑器")).not.toBeInTheDocument();
  });

  it("uses the shared player for a playable finished video", () => {
    render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "点击画面播放视频" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "调整视频预览高度" })).not.toBeInTheDocument();
  });

  it("keeps the persisted BGM choice out of the default browse view", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    render(<ProductPreview product={{
      ...product,
      metadata: {
        ...product.metadata,
        video_project: {
          ...(product.metadata?.video_project as Record<string, unknown>),
          media: [
            { id: "media-1", type: "image", ref: "display-sample.png" },
            { id: "media-bgm-tech", type: "audio", file_path: "bgm://bgm-tech-01", name: "科技向前" },
          ],
          metadata: {
            bgm_choice: { enabled: true, catalog_id: "bgm-tech-01", selected_by: "auto" },
          },
        },
      },
    }} />);

    expect(screen.queryByRole("status", { name: "背景音乐" })).not.toBeInTheDocument();
  });

  it("shows background music in details instead of the default browse view", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={vi.fn(async () => undefined)}
        product={{
          ...product,
          metadata: {
            ...product.metadata,
            video_project: {
              ...(product.metadata?.video_project as Record<string, unknown>),
              media: [{ id: "media-bgm-tech", type: "audio", file_path: "bgm://bgm-tech-01", name: "科技向前" }],
              metadata: {
                bgm_choice: { enabled: true, catalog_id: "bgm-tech-01", selected_by: "auto" },
              },
            },
          },
        }}
        selectedConversation={conversationForDisplayProduct(product)}
      />,
    );

    fireEvent.click(screen.getByText("详情", { exact: true }));
    expect(screen.getByText("本片素材", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("背景音乐：科技向前 · AI 匹配", { exact: true })).toBeInTheDocument();
  });

  it("seeks the finished video when a storyboard card is selected", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA });
    fireEvent.canPlay(video);

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

  it("starts a real recovery for a failed full video", async () => {
    const retryVideo = vi.fn(async () => undefined);
    const product = displayProducts["case-07-project-ready-mp4"];
    const { container } = render(<ProductPreview product={product} onRetryVideoJob={retryVideo} />);

    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("成片暂时无法播放");
    fireEvent.click(screen.getByRole("button", { name: "重试成片" }));
    await waitFor(() => expect(retryVideo).toHaveBeenCalledWith(product));
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
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

  it("shows the single automatic animation mode and its delivered scene counts", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const videoPlan = base.metadata?.video_plan as Record<string, unknown>;
    render(<ProductPreview product={{
      ...base,
      metadata: {
        ...base.metadata,
        video_plan: {
          ...videoPlan,
          summary: {
            ...((videoPlan.summary as Record<string, unknown>) ?? {}),
            animation_mode_label: "自动丰富",
            animation_overlay_count: 2,
            animation_full_scene_count: 1,
            animation_protected_count: 3,
            animation_effect_count: 4,
          },
        },
      },
    }} />);

    expect(screen.getByText("动画编排：自动丰富")).toBeInTheDocument();
    expect(screen.getByText("2 个分镜动态增强")).toBeInTheDocument();
    expect(screen.queryByText("2 个分镜 MG 增强")).not.toBeInTheDocument();
    expect(screen.getByText("1 个受限全屏动画")).toBeInTheDocument();
    expect(screen.getByText("3 个分镜保护真实素材")).toBeInTheDocument();
    expect(screen.getByText("4 类受控效果")).toBeInTheDocument();
    expect(screen.getByLabelText("来源引用")).toContainElement(screen.getByText("动画编排：自动丰富"));
    expect(document.querySelector(".shadcn-prototype-video-plan-summary")).not.toBeInTheDocument();
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
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("视频生成中"))).toBe(true);
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });

  it("shows a stable failure with retry and no project controls", () => {
    renderWorkspace("case-05-project-failed");
    expect(screen.getByRole("alert")).toHaveTextContent("素材合成步骤失败，请重试");
    expect(screen.getByRole("button", { name: /重试生成/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });

  it("does not offer a blind retry when a confirmed source file is missing", () => {
    const base = displayProducts["case-05-project-failed"];
    render(<ProductPreview product={{
      ...base,
      failureReason: "第 4 镜的原素材不可用，请确认是否重新寻找该镜素材。",
      failureAction: "replace_scene_asset",
    }} />);

    expect(screen.getByRole("button", { name: "重新寻找该镜素材" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重试生成/ })).not.toBeInTheDocument();
    expect(screen.getByText("系统不会自动替换已经确认的素材。")).toBeInTheDocument();
  });

  it.each(["case-06-project-ready-no-mp4"] as const)(
    "keeps %s editable without pretending an MP4 exists",
    (caseId) => {
      const { container } = renderWorkspace(caseId);
      expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /导出/ })).toBeInTheDocument();
      expect(container.querySelector("iframe.shadcn-prototype-export-bridge")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "编辑" }));
      const editorFrame = container.querySelector("iframe.shadcn-prototype-editor-frame");
      expect(editorFrame).toBeInTheDocument();
      expect(editorFrame?.parentElement).toHaveClass(
        "shadcn-prototype-editor-host",
        "ratio-portrait",
      );
      expect(container.querySelector("video")).not.toBeInTheDocument();
    },
  );

  it("keeps the editor open when an auto-save invalidates the previous export", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    const workspace = (currentProduct: typeof product) => (
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={vi.fn(async () => undefined)}
        product={currentProduct}
        selectedConversation={conversationForDisplayProduct(currentProduct)}
      />
    );
    const { rerender } = render(workspace(product));

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成编辑" })).toBeInTheDocument();

    const refreshedProduct = {
      ...product,
      metadata: {
        ...product.metadata,
        video_project: {
          ...(product.metadata?.video_project as Record<string, unknown>),
          mp4_ref: null,
        },
      },
    };
    rerender(workspace(refreshedProduct));

    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成编辑" })).toBeInTheDocument();
  });

  it("renders a real video element only for the MP4 case", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    expect(container.querySelector("video")).toHaveAttribute("src", expect.stringContaining("display-sample.mp4"));
  });

  it("delegates preflight to the editor after the current project is saved", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const getVideoQuality = vi.spyOn(assetWorkspaceAdapter, "getVideoQuality");
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
    const frame = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    dispatchPreviewMessage(frame, product.backendAssetId, { type: "multimix-editor-ready" });
    fireEvent.click(await screen.findByRole("button", { name: "导出视频" }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-export" },
      window.location.origin,
    ));
    expect(getVideoQuality).not.toHaveBeenCalled();

    dispatchPreviewMessage(frame, product.backendAssetId, {
      type: "multimix-editor-export-quality-report",
      report: {
        stage: "export_preflight",
        status: "blocked",
        blockers: [{
          code: "main_track_gap",
          segment_id: "scene-1",
          object_type: "main_track",
          message: "第 1 段主画面没有覆盖。",
          suggested_actions: ["补齐主轨素材"],
        }],
        warnings: [],
      } satisfies VideoQualityReport,
    });
    expect(await screen.findByRole("button", { name: "修复后重新检查" })).toBeEnabled();
  });

  it("allows warning-only preflight to export through the existing preview", async () => {
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
        suggested_actions: [],
      }],
    };
    vi.spyOn(assetWorkspaceAdapter, "getVideoQuality").mockResolvedValue(warningOnly);
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
    expect(screen.queryByTitle("视频剪辑器")).not.toBeInTheDocument();
    const frame = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.click(screen.getByRole("button", { name: "导出视频" }));

    dispatchPreviewMessage(frame, product.backendAssetId, { type: "multimix-editor-ready" });

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

    const frame = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    await act(async () => {
      dispatchPreviewMessage(frame, product.backendAssetId, { type: "multimix-editor-ready" });
      dispatchPreviewMessage(frame, product.backendAssetId, {
        type: "multimix-editor-export-error",
        message: "VideoFrames can't be created from tainted sources.",
      });
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

    const frame = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    await act(async () => {
      dispatchPreviewMessage(frame, product.backendAssetId, { type: "multimix-editor-ready" });
      dispatchPreviewMessage(frame, product.backendAssetId, {
        type: "multimix-editor-export-progress",
        progress: 0.42,
      });
    });

    expect(screen.getByRole("button", { name: "正在合成视频 42%" })).toBeDisabled();
  });

  it("requires a fresh user click to download the verified export without rendering again", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    renderWorkspace("case-06-project-ready-no-mp4");

    const frame = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    await act(async () => {
      dispatchPreviewMessage(frame, product.backendAssetId, { type: "multimix-editor-ready" });
      dispatchPreviewMessage(frame, product.backendAssetId, {
        type: "multimix-editor-export-success",
        report: { stage: "export_output", status: "passed", blockers: [], warnings: [] },
        blob: new Blob(["verified-mp4"], { type: "video/mp4" }),
      });
    });

    expect(screen.getByRole("button", { name: "下载成片" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "再次导出" })).not.toBeInTheDocument();
  });
});
