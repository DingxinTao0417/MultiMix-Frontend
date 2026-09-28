// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentAsset } from "../../../lib/api";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

const apiMocks = vi.hoisted(() => ({
  getContentAssetVersionPreview: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/api")>(),
  getContentAssetVersionPreview: apiMocks.getContentAssetVersionPreview,
}));

// The independent advisory panel owns its own API tests; keep these playback
// and editing tests' ordered fetch fixtures scoped to the operation under test.
vi.mock("../../../lib/video-project-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/video-project-client")>(),
  getFilmReviews: vi.fn(async () => ({ can_review: false, unavailable_reason: null,
    script_review: null, reviews: [] })),
}));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  apiMocks.getContentAssetVersionPreview.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function historicalVideoAsset({ mp4Ref = "previous.mp4" }: { mp4Ref?: string } = {}): ContentAsset {
  return {
    id: 9100,
    project_id: 1,
    parent_asset_id: null,
    asset_kind: "video",
    content_type: "video_project",
    title: "门店获客短视频",
    status: "ready",
    source_filename: null,
    source_content_type: null,
    original_ref: null,
    markdown_ref: null,
    content_hash: "historical-v1",
    body: "历史稳定版本",
    metadata: {
      orchestration_pending: false,
      video_workflow_stage: "video_project_ready",
      video_project: {
        ratio: "9:16",
        duration_seconds: 3,
        mp4_ref: mp4Ref || null,
        tracks: [{ id: "main", type: "video", clips: [] }],
        media: [{ id: "media-1", type: "image", ref: "display-sample.png" }],
        segments: [
          { id: "segment-1", title: "门店外观", startTime: 0, duration: 1.5, narration: "原始开场" },
          { id: "segment-2", title: "服务过程", startTime: 1.5, duration: 1.5, narration: "原始过程" },
        ],
      },
    },
    linked_asset_ids: [],
    linked_event_ids: [],
    archived: false,
    error_message: null,
    product_status: "completed",
    product_completed: true,
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    versions: [],
  };
}

function chooseVideoExport(variant: "原始成片" | "品牌展示版" = "原始成片") {
  fireEvent.click(screen.getByRole("button", { name: "导出视频" }));
  fireEvent.click(screen.getByRole("menuitem", { name: variant }));
}

function dispatchEditorMessage(data: Record<string, unknown>) {
  if (!screen.queryByTitle("视频剪辑器")) fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  const frame = screen.getByTitle("视频剪辑器") as HTMLIFrameElement;
  const target = frame.contentWindow!;
  const send = vi.isMockFunction(target.postMessage) ? vi.mocked(target.postMessage) : vi.spyOn(target, "postMessage");
  let request = send.mock.calls.map(([payload]) => payload as { type?: string; requestId?: string })
    .filter((payload) => payload.type === "multimix-editor-export").at(-1);
  if (String(data.type).startsWith("multimix-editor-export") && !request) {
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: target,
      data: { source: "multimix-editor", assetId: data.assetId, type: "multimix-editor-ready" } })));
    chooseVideoExport(data.exportVariant === "brand_showcase" ? "品牌展示版" : "原始成片");
    request = send.mock.calls.map(([payload]) => payload as { type?: string; requestId?: string })
      .filter((payload) => payload.type === "multimix-editor-export").at(-1);
  }
  act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: target,
    data: { ...data, ...(String(data.type).startsWith("multimix-editor-export") ? { requestId: request?.requestId } : {}) } })));
}

describe("video browse actions", () => {
  it("rejects an export response from a different window even for the same asset", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);
    act(() => window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin, source: window,
      data: { source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-export-error", message: "旧窗口失败" },
    })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("rejects a response for an older export request from the current iframe", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const frame = screen.getByTitle("视频剪辑器") as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, "postMessage");
    dispatchEditorMessage({ source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-ready" });
    chooseVideoExport();
    const first = send.mock.calls.map(([payload]) => payload).find((payload) => payload.type === "multimix-editor-export");
    dispatchEditorMessage({ source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-export-error", message: "本次失败" });
    chooseVideoExport();
    const second = send.mock.calls.map(([payload]) => payload).filter((payload) => payload.type === "multimix-editor-export").at(-1);
    expect(second.requestId).not.toEqual(first.requestId);
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: frame.contentWindow,
      data: { source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-export-success",
        requestId: first.requestId, blob: new Blob(["old"]), report: { stage: "export_file", status: "pass", blockers: [], warnings: [] } } })));
    expect(screen.getByRole("button", { name: "原始成片 · 正在合成 …" })).toBeDisabled();
  });
  it("separates single-video production from dual-player version review", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const currentProduct = {
      ...base,
      version: "v2",
      versions: [
        { id: "41", label: "v1", savedAt: "1 分钟前", status: "初始版本" },
        { id: "42", label: "v2", savedAt: "刚刚", status: "修订：节奏更紧凑" },
      ],
      segments: [
        { ...base.segments![0], endSeconds: 1.2, line: "新版开场" },
        { ...base.segments![1], startSeconds: 1.2, line: "新版过程" },
      ],
    };
    apiMocks.getContentAssetVersionPreview.mockResolvedValueOnce(historicalVideoAsset());
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={currentProduct}
        selectedConversation={conversationForDisplayProduct(currentProduct)}
        token="token"
      />,
    );

    expect(screen.getByLabelText("分镜摘要")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "版本对比" }));

    const comparison = await screen.findByRole("region", { name: "版本对比" });
    expect(apiMocks.getContentAssetVersionPreview).toHaveBeenCalledWith("token", 9100, 41);
    expect(screen.queryByLabelText("分镜摘要")).not.toBeInTheDocument();
    expect(screen.getByLabelText("修改前 · v1")).toBeInTheDocument();
    expect(screen.getByLabelText("修改后 · v2")).toBeInTheDocument();
    expect(comparison).toHaveTextContent("受影响的分镜");

    const beforeVideo = screen.getByLabelText("修改前 · v1").querySelector("video")!;
    const afterVideo = screen.getByLabelText("修改后 · v2").querySelector("video")!;
    expect(beforeVideo.muted).toBe(true);
    expect(afterVideo.muted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "试听修改前" }));
    expect(beforeVideo.muted).toBe(false);
    expect(afterVideo.muted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "试听修改后" }));
    expect(beforeVideo.muted).toBe(true);
    expect(afterVideo.muted).toBe(false);
    for (const video of [beforeVideo, afterVideo]) {
      Object.defineProperty(video, "duration", { configurable: true, value: 3 });
      Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
      fireEvent.loadedMetadata(video);
      fireEvent.canPlay(video);
    }

    fireEvent.click(screen.getByRole("button", { name: /服务过程/ }));
    expect(beforeVideo.currentTime).toBe(1.5);
    expect(afterVideo.currentTime).toBe(1.2);
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /服务过程/ })).toHaveAttribute("aria-expanded", "true");
    expect(comparison).toHaveTextContent("原始过程");
    expect(comparison).toHaveTextContent("新版过程");

    const sceneButton = screen.getByRole("button", { name: /服务过程/ });
    const playersRegion = within(comparison).getByRole("group", { name: "对比分镜播放器" });
    await waitFor(() => expect(playersRegion).toHaveFocus());
    sceneButton.focus();
    fireEvent.click(sceneButton);
    expect(playersRegion).toHaveFocus();
    expect(sceneButton).toHaveAttribute("aria-expanded", "true");
    expect(within(comparison).getByText("原始过程")).toBeVisible();

    play.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: /服务过程/ }));
    await waitFor(() => expect(comparison).toHaveTextContent("浏览器阻止了自动播放"));

    play.mockRejectedValueOnce(new DOMException("Unsupported codec", "NotSupportedError"));
    fireEvent.click(screen.getByRole("button", { name: /服务过程/ }));
    await waitFor(() => expect(comparison).toHaveTextContent("当前视频无法解码"));
    expect(comparison).not.toHaveTextContent("浏览器阻止了自动播放，请点击画面播放。");

    fireEvent.click(screen.getByRole("button", { name: "单视频" }));
    expect(screen.getByLabelText("分镜摘要")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "版本对比" })).not.toBeInTheDocument();
  });

  it("does not present a stale counterpart or a silent audio choice for an added scene", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const currentProduct = {
      ...base,
      version: "v2",
      versions: [
        { id: "41", label: "v1", savedAt: "稍早", status: "初始版本" },
        { id: "42", label: "v2", savedAt: "刚刚", status: "修订版本" },
      ],
      segments: [{ id: "segment-added", index: 3, title: "新增收束", startSeconds: 3, endSeconds: 4, isFallback: false }],
    };
    apiMocks.getContentAssetVersionPreview.mockResolvedValueOnce(historicalVideoAsset());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={currentProduct}
      selectedConversation={conversationForDisplayProduct(currentProduct)} token="token" />);
    fireEvent.click(screen.getByRole("button", { name: "版本对比" }));
    const comparison = await screen.findByRole("region", { name: "版本对比" });
    const playersRegion = within(comparison).getByRole("group", { name: "对比分镜播放器" });
    expect(within(playersRegion).getByRole("group", { name: "修改前 · v1" })).toBeInTheDocument();
    expect(within(playersRegion).getByRole("button", { name: "修改前 · v1：播放视频" })).toBeInTheDocument();
    expect(within(playersRegion).getByRole("slider", { name: "修改前 · v1：播放进度" })).toBeInTheDocument();
    expect(within(playersRegion).getByRole("group", { name: "修改后 · v2" })).toBeInTheDocument();
    expect(within(playersRegion).getByRole("button", { name: "修改后 · v2：播放视频" })).toBeInTheDocument();
    expect(within(playersRegion).getByRole("slider", { name: "修改后 · v2：播放进度" })).toBeInTheDocument();
    expect(within(comparison).queryByText("修改前无对应分镜")).not.toBeInTheDocument();
    expect(playersRegion.querySelectorAll(".shadcn-prototype-video-comparison-player-media[inert]")).toHaveLength(0);
    expect(within(comparison).queryByText("已定位到对应位置")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "试听修改前" }));
    const beforeVideo = screen.getByLabelText("修改前 · v1").querySelector("video")!;
    const afterVideo = screen.getByLabelText("修改后 · v2").querySelector("video")!;
    for (const video of [beforeVideo, afterVideo]) {
      Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    }
    fireEvent.click(screen.getByRole("button", { name: /新增收束/ }));
    expect(comparison).toHaveTextContent("修改前无对应分镜");
    expect(comparison).toHaveTextContent("修改前没有对应分镜");
    expect(playersRegion).toHaveFocus();
    expect(comparison).not.toHaveTextContent("已同步定位");
    expect(beforeVideo.muted).toBe(true);
    expect(afterVideo.muted).toBe(false);
    expect(afterVideo.currentTime).toBe(3);
    expect(screen.queryByRole("button", { name: "试听修改前" })).not.toBeInTheDocument();
  });

  it("routes a removed scene to the previous player only", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const currentProduct = {
      ...base, version: "v2",
      versions: [
        { id: "41", label: "v1", savedAt: "稍早", status: "初始版本" },
        { id: "42", label: "v2", savedAt: "刚刚", status: "修订版本" },
      ],
    };
    const historical = historicalVideoAsset();
    const videoProject = historical.metadata.video_project as Record<string, unknown>;
    videoProject.segments = [
      ...(videoProject.segments as unknown[]),
      { id: "segment-removed", title: "旧收束", startTime: 3, duration: 1, narration: "旧版结束" },
    ];
    apiMocks.getContentAssetVersionPreview.mockResolvedValueOnce(historical);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={currentProduct}
      selectedConversation={conversationForDisplayProduct(currentProduct)} token="token" />);
    fireEvent.click(screen.getByRole("button", { name: "版本对比" }));
    const comparison = await screen.findByRole("region", { name: "版本对比" });
    const beforeVideo = screen.getByLabelText("修改前 · v1").querySelector("video")!;
    const afterVideo = screen.getByLabelText("修改后 · v2").querySelector("video")!;
    for (const video of [beforeVideo, afterVideo]) {
      Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_METADATA });
    }
    fireEvent.click(screen.getByRole("button", { name: /旧收束/ }));
    expect(comparison).toHaveTextContent("修改后无对应分镜");
    expect(beforeVideo.muted).toBe(false);
    expect(afterVideo.muted).toBe(true);
    expect(beforeVideo.currentTime).toBe(3);
  });

  it("opens version review when a mounted completed video publishes the next version", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const firstVersion = {
      ...base,
      version: "v1",
      versions: [{ id: "41", label: "v1", savedAt: "刚刚", status: "初始版本" }],
    };
    const nextVersion = {
      ...base,
      version: "v2",
      versions: [
        firstVersion.versions[0],
        { id: "42", label: "v2", savedAt: "刚刚", status: "修订版本" },
      ],
    };
    apiMocks.getContentAssetVersionPreview.mockResolvedValueOnce(historicalVideoAsset());
    const { rerender } = render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={firstVersion}
        selectedConversation={conversationForDisplayProduct(firstVersion)}
        token="token"
      />,
    );
    expect(screen.getByLabelText("分镜摘要")).toBeInTheDocument();

    rerender(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={nextVersion}
        selectedConversation={conversationForDisplayProduct(nextVersion)}
        token="token"
      />,
    );

    expect(await screen.findByRole("region", { name: "版本对比" })).toBeInTheDocument();
    expect(apiMocks.getContentAssetVersionPreview).toHaveBeenCalledWith("token", 9100, 41);
  });

  it("keeps single-video mode when the previous version has no playable full video", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const currentProduct = {
      ...base,
      version: "v2",
      versions: [
        { id: "41", label: "v1", savedAt: "1 分钟前", status: "初始版本" },
        { id: "42", label: "v2", savedAt: "刚刚", status: "修订版本" },
      ],
    };
    apiMocks.getContentAssetVersionPreview.mockResolvedValueOnce(historicalVideoAsset({ mp4Ref: "" }));

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={currentProduct}
        selectedConversation={conversationForDisplayProduct(currentProduct)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "版本对比" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上一版本没有可播放的完整视频");
    expect(screen.getByLabelText("分镜摘要")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "版本对比" })).not.toBeInTheDocument();
  });

  it("discards a historical preview that arrives after switching to another video", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const oldProduct = {
      ...base,
      version: "v2",
      versions: [
        { id: "41", label: "v1", savedAt: "稍早", status: "初始版本" },
        { id: "42", label: "v2", savedAt: "刚刚", status: "修订版本" },
      ],
    };
    let completePreview!: (asset: ContentAsset) => void;
    apiMocks.getContentAssetVersionPreview.mockImplementationOnce(() => new Promise<ContentAsset>((resolve) => {
      completePreview = resolve;
    }));
    const props = {
      copied: false,
      onCopyProduct: vi.fn(async () => undefined),
      onSaveProduct: vi.fn(async () => undefined),
      token: "token",
    };
    const { rerender } = render(
      <ProductWorkspace
        {...props}
        product={oldProduct}
        selectedConversation={conversationForDisplayProduct(oldProduct)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "版本对比" }));

    const nextProduct = { ...base, backendAssetId: 9200, version: "v1", versions: [] };
    rerender(
      <ProductWorkspace
        {...props}
        product={nextProduct}
        selectedConversation={conversationForDisplayProduct(nextProduct)}
      />,
    );
    await act(async () => { completePreview(historicalVideoAsset()); });

    expect(screen.queryByRole("region", { name: "版本对比" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("分镜摘要")).toBeInTheDocument();
  });

  it("sends an optional Presenter material failure back to the script instead of issuing a fake retry", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const product = {
      ...base,
      operationStatus: "failed" as const,
      operationFailureReason: "部分可选素材视觉事件未能完成，人物视频仍可继续编辑；请补充素材后重新生成。",
      operationFailureAction: "modify_script" as const,
    };
    const composerFocus = vi.fn();
    window.addEventListener("multimix:composer-focus", composerFocus);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(screen.getByText(product.operationFailureReason)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补充素材或修改编导脚本" }));
    expect(composerFocus).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "重试本次修改" })).not.toBeInTheDocument();
    window.removeEventListener("multimix:composer-focus", composerFocus);
  });

  it("retries an optional Presenter MG render through the server-issued child job", async () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const product = {
      ...base,
      operationStatus: "failed" as const,
      operationFailureReason: "部分可选图形动效未能完成，人物视频仍可继续编辑；可重试补齐。",
      operationFailureAction: "retry" as const,
    };
    const onRetryVideoJob = vi.fn(async () => undefined);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={onRetryVideoJob}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
        videoJobLive={{
          jobId: "main-1",
          status: "completed",
          workflowStage: "done",
          steps: [
            { key: "create_job", label: "创建视频工程", status: "done", retryJobId: null },
            { key: "mg_overlay", label: "生成并添加 MG 动效", status: "fail", retryJobId: "mg-child-1" },
          ],
          errorMessage: null,
          completionConfirmed: true,
          productStatus: "completed",
          productCompleted: true,
          operationStatus: "failed",
          operationFailureReason: product.operationFailureReason,
          operationFailureAction: "retry",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试本次修改" }));
    await waitFor(() => expect(onRetryVideoJob).toHaveBeenCalledWith(product, "mg-child-1"));
  });

  it("does not expose editing or export until the server confirms product completion", () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const product = {
      ...base,
      productStatus: "generating" as const,
      videoProductCompleted: false,
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });

  it("offers a completed source excerpt a structured subtitle-version action", () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const product = {
      ...base,
      backendAssetId: 948,
      metadata: {
        ...base.metadata,
        video_plan: {
          ...(base.metadata?.video_plan as Record<string, unknown>),
          video_type: "source_excerpt",
          subtitle_output: { source_language: "en", mode: "translated_zh" },
        },
      },
    };
    const composerSend = vi.fn();
    window.addEventListener("multimix:composer-send", composerSend);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "字幕语言" }));
    expect(screen.getByRole("button", { name: "中文字幕（当前）" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "中英双语" }));

    expect(composerSend).toHaveBeenCalledWith(expect.objectContaining({
      detail: {
        utterance: "确认，生成字幕新版本",
        confirmationProductId: 948,
        sourceSubtitleMode: "bilingual",
      },
    }));
    window.removeEventListener("multimix:composer-send", composerSend);
  });

  it("marks the persisted subtitle variant as current", () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const product = {
      ...base,
      metadata: {
        ...base.metadata,
        source_subtitle_mode: "bilingual",
        video_plan: {
          ...(base.metadata?.video_plan as Record<string, unknown>),
          video_type: "source_excerpt",
          subtitle_output: { source_language: "en" },
        },
      },
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "字幕语言" }));
    expect(screen.getByRole("button", { name: "中英双语（当前）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "中文字幕" })).toBeEnabled();
  });

  it("keeps the menu available for a persisted variant whose legacy source language was misprojected", () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const product = {
      ...base,
      metadata: {
        ...base.metadata,
        source_subtitle_mode: "bilingual",
        video_plan: {
          ...(base.metadata?.video_plan as Record<string, unknown>),
          video_type: "source_excerpt",
          subtitle_output: { source_language: "zh-CN", mode: "bilingual" },
        },
      },
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "字幕语言" }));
    expect(screen.getByRole("button", { name: "中英双语（当前）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "中文字幕" })).toBeEnabled();
  });

  it("does not offer subtitle versions for an ordinary completed video", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(screen.queryByRole("button", { name: "字幕语言" })).not.toBeInTheDocument();
  });

  it("restores download for an already persisted MP4 without exporting again", async () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    const getVideoQuality = vi.spyOn(assetWorkspaceAdapter, "getVideoQuality");
    let downloadedHref = "";
    const downloadFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(new TextEncoder().encode("mp4"), { status: 200 }));
    vi.stubGlobal("fetch", downloadFetch);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:restored-export"),
      revokeObjectURL: vi.fn(),
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function captureDownloadHref(this: HTMLAnchorElement) {
      downloadedHref = this.href;
    });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
    chooseVideoExport();

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(getVideoQuality).not.toHaveBeenCalled();
    expect(downloadFetch).toHaveBeenCalledWith(expect.stringContaining("/v1/video/media?ref=display-sample.mp4"));
    expect(downloadedHref).toBe("blob:restored-export");
  });

  it("does not offer a persisted MP4 whose verified fingerprint is stale", () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    const staleProduct = {
      ...product,
      metadata: {
        ...product.metadata,
        video_export_current: false,
      },
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={staleProduct}
        selectedConversation={conversationForDisplayProduct(staleProduct)}
        token="token"
      />,
    );

    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "下载成片" })).not.toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeInTheDocument();
  });

  it("exports the current embedded editor project instead of downloading the previous MP4", async () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    const downloadFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", downloadFetch);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const frame = screen.getByTitle("视频剪辑器") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-ready",
      });

    await screen.findByRole("button", { name: "导出视频" });
    chooseVideoExport();

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "multimix-workspace",
        type: "multimix-editor-export",
        exportVariant: "original",
      }),
      window.location.origin,
    ));
    expect(downloadFetch).not.toHaveBeenCalled();
  });

  it("invalidates the previous MP4 immediately after the embedded editor saves changes", async () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockImplementation(
      () => new Promise(() => undefined),
    );

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-project-updated",
        reason: "timeline",
      });

    expect(await screen.findByRole("button", { name: "导出视频" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "下载成片" })).not.toBeInTheDocument();
  });

  it("flushes embedded timeline edits before exit, keeps the editor on failure, and exits only after retry succeeds", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const onProductUpdated = vi.fn();
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue({
      ...conversationForDisplayProduct(product),
      product,
      products: [product],
    });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={onProductUpdated}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const frame = screen.getByTitle("视频剪辑器") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    dispatchEditorMessage({ source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-ready" });
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-ready-ack" },
      window.location.origin,
    ));

    fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ source: "multimix-workspace", type: "multimix-editor-flush" }),
      window.location.origin,
    ));
    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在保存…" })).toBeDisabled();
    const firstFlush = postMessage.mock.calls.find(
      ([message]) => (message as { type?: string }).type === "multimix-editor-flush",
    )?.[0] as { requestId: string };

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-flush-result",
        requestId: firstFlush.requestId,
        status: "error",
        message: "保存失败，请检查网络后重试。",
      });

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请检查网络后重试。");
    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(postMessage.mock.calls.filter(
      ([message]) => (message as { type?: string }).type === "multimix-editor-flush",
    )).toHaveLength(2));
    const retryFlush = postMessage.mock.calls.filter(
      ([message]) => (message as { type?: string }).type === "multimix-editor-flush",
    ).at(-1)?.[0] as { requestId: string };

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-flush-result",
        requestId: retryFlush.requestId,
        status: "saved",
      });

    await waitFor(() => expect(screen.queryByTitle("视频剪辑器")).not.toBeInTheDocument());
    expect(onProductUpdated).toHaveBeenCalledWith(product);
  });

  it("warns before a page unload while the embedded editor reports unsaved timeline changes", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-save-state",
        status: "dirty",
      });

    await waitFor(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it("finishes an embedded editor export with a fresh explicit download action", async () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    let downloadedHref = "";
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fresh-export"),
      revokeObjectURL: vi.fn(),
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function captureDownloadHref(this: HTMLAnchorElement) {
      downloadedHref = this.href;
    });
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const frame = screen.getByTitle("视频剪辑器") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-ready",
      });
    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-progress",
        progress: 0.42,
      });
    expect(await screen.findByRole("button", { name: "原始成片 · 正在合成 42%" })).toBeDisabled();

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-success",
        report: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
        blob: new Blob(["fresh-mp4"], { type: "video/mp4" }),
      });

    const downloadButton = await screen.findByRole("button", { name: "导出视频" });
    expect(downloadButton).toBeEnabled();
    postMessage.mockClear();

    chooseVideoExport();

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(downloadedHref).toBe("blob:fresh-export");
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: "multimix-workspace", type: "multimix-editor-export" }),
      window.location.origin,
    );
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
  });

  it("shows distinct upload and server verification phases", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-hashing",
      });
    expect(await screen.findByRole("button", { name: "原始成片 · 正在计算文件指纹" })).toBeDisabled();

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-uploading",
      });
    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-progress",
        progress: 0.5,
      });
    expect(await screen.findByRole("button", { name: "原始成片 · 正在上传 50%" })).toBeDisabled();

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-verifying",
      });
    expect(await screen.findByRole("button", { name: "原始成片 · 正在检查" })).toBeDisabled();

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-publishing",
      });
    expect(await screen.findByRole("button", { name: "原始成片 · 正在发布" })).toBeDisabled();
  });

  it("resumes a persisted publishing task with the publishing label", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue({
      id: "video-export-publishing",
      assetId: product.backendAssetId!,
      status: "running",
      stage: "publishing",
      retryable: false,
      errorMessage: null,
      qualityReport: null,
      mp4Ref: null,
      exportVariant: "original",
      brandSpecVersion: null,
      timingEvents: [],
    });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockReturnValue(new Promise(() => {}));

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByRole("button", { name: "原始成片 · 正在发布" })).toBeDisabled();
  });

  it("restores the quality findings of a persisted failed export", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const getVideoQuality = vi.spyOn(assetWorkspaceAdapter, "getVideoQuality");
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue({
      id: "video-export-quality-failed",
      assetId: product.backendAssetId!,
      status: "failed",
      stage: "failed",
      retryable: false,
      errorMessage: "Exported video did not pass quality verification.",
      qualityReport: {
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
      },
      mp4Ref: null,
      exportVariant: "original",
      brandSpecVersion: null,
    });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByRole("status", { name: "视频质量检查" })).toHaveTextContent("无法从主视频流核对导出画面的结束时间");
    expect(screen.getByText("建议：检查视频轨后重新导出")).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新检查" })).not.toBeInTheDocument();
    expect(getVideoQuality).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("成片未通过质量检查，请查看具体问题后重新导出。");
    expect(screen.queryByText("Exported video did not pass quality verification.")).not.toBeInTheDocument();
  });

  it("explains that an interrupted browser-local export must be restarted", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    window.sessionStorage.setItem(
      `multimix-video-export-local:${product.backendAssetId}:original`,
      JSON.stringify({ stage: "composing", startedAt: Date.now() }),
    );
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(null);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByText("上次导出在浏览器本地阶段中断，无法自动恢复，请重新导出。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
  });

  it("attributes an interrupted browser-local brand export to the brand variant", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    window.sessionStorage.setItem(
      `multimix-video-export-local:${product.backendAssetId}:brand_showcase`,
      JSON.stringify({ stage: "uploading", startedAt: Date.now() }),
    );
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(null);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByText("上次导出在浏览器本地阶段中断，无法自动恢复，请重新导出。")).toBeInTheDocument();
    expect(screen.getByText("品牌展示版导出失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
  });

  it("resumes a running export task after the workspace remounts", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    let finish!: (value: {
      id: string;
      assetId: number;
      status: "completed";
      stage: "done";
      retryable: false;
      errorMessage: null;
      qualityReport: { stage: string; status: string; blockers: never[]; warnings: never[] };
      mp4Ref: string;
      exportVariant: "original";
      brandSpecVersion: null;
    }) => void;
    const terminal = new Promise<Parameters<typeof finish>[0]>((resolve) => { finish = resolve; });
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue({
      id: "video-export-1",
      assetId: product.backendAssetId!,
      status: "running",
      stage: "verifying",
      retryable: false,
      errorMessage: null,
      qualityReport: null,
      mp4Ref: null,
      exportVariant: "original",
      brandSpecVersion: null,
    });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockReturnValue(terminal);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue(
      conversationForDisplayProduct(product) as never,
    );
    const onProductUpdated = vi.fn();

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={onProductUpdated}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByRole("button", { name: "原始成片 · 正在检查" })).toBeDisabled();
    finish({
      id: "video-export-1",
      assetId: product.backendAssetId!,
      status: "completed",
      stage: "done",
      retryable: false,
      errorMessage: null,
      qualityReport: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
      mp4Ref: "supabase://exports/final.mp4",
      exportVariant: "original",
      brandSpecVersion: null,
    });

    await waitFor(() => expect(onProductUpdated).toHaveBeenCalledTimes(1));
  });

  it("shows persisted uploaded jobs as checking rather than uploading", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue({
      id: "video-export-uploaded",
      assetId: product.backendAssetId!,
      status: "queued",
      stage: "uploaded",
      retryable: false,
      errorMessage: null,
      qualityReport: null,
      mp4Ref: null,
      exportVariant: "original",
      brandSpecVersion: null,
    });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockReturnValue(new Promise(() => {}));

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByRole("button", { name: "原始成片 · 正在检查" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "原始成片 · 正在上传" })).not.toBeInTheDocument();
  });

  it("does not abort export recovery when the parent replaces its update callback", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    let finishCurrent!: (value: {
      id: string;
      assetId: number;
      status: "completed";
      stage: "done";
      retryable: false;
      errorMessage: null;
      qualityReport: { stage: string; status: string; blockers: never[]; warnings: never[] };
      mp4Ref: string;
      exportVariant: "original";
      brandSpecVersion: null;
    }) => void;
    let recoverySignal: AbortSignal | undefined;
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockImplementation(
      (_token, _assetId, _variant, signal) => new Promise((resolve, reject) => {
        recoverySignal = signal;
        finishCurrent = resolve;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue(
      conversationForDisplayProduct(product) as never,
    );
    const firstUpdate = vi.fn();
    const latestUpdate = vi.fn();
    const props = {
      copied: false,
      onCopyProduct: vi.fn(async () => undefined),
      onSaveProduct: vi.fn(async () => undefined),
      product,
      selectedConversation: conversationForDisplayProduct(product),
      token: "token",
    };

    const { rerender } = render(<ProductWorkspace {...props} onProductUpdated={firstUpdate} />);
    await waitFor(() => expect(recoverySignal).toBeDefined());
    rerender(<ProductWorkspace {...props} onProductUpdated={latestUpdate} />);
    expect(recoverySignal?.aborted).toBe(false);

    finishCurrent({
      id: "video-export-callback-race",
      assetId: product.backendAssetId!,
      status: "completed",
      stage: "done",
      retryable: false,
      errorMessage: null,
      qualityReport: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
      mp4Ref: "supabase://exports/final.mp4",
      exportVariant: "original",
      brandSpecVersion: null,
    });

    await waitFor(() => expect(latestUpdate).toHaveBeenCalledTimes(1));
    expect(firstUpdate).not.toHaveBeenCalled();
  });

  it("retries export recovery when a token change aborts the startup query", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const completed = {
      id: "video-export-token-race",
      assetId: product.backendAssetId!,
      status: "completed" as const,
      stage: "done" as const,
      retryable: false,
      errorMessage: null,
      qualityReport: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
      mp4Ref: "supabase://exports/final.mp4",
      exportVariant: "original" as const,
      brandSpecVersion: null,
    };
    const getCurrent = vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport")
      .mockImplementationOnce((_token, _assetId, _variant, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }))
      .mockResolvedValueOnce(completed);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue(
      conversationForDisplayProduct(product) as never,
    );
    const onProductUpdated = vi.fn();
    const props = {
      copied: false,
      onCopyProduct: vi.fn(async () => undefined),
      onSaveProduct: vi.fn(async () => undefined),
      onProductUpdated,
      product,
      selectedConversation: conversationForDisplayProduct(product),
    };

    const { rerender } = render(<ProductWorkspace {...props} token="token-1" />);
    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(1));
    rerender(<ProductWorkspace {...props} token="token-2" />);

    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onProductUpdated).toHaveBeenCalledTimes(1));
  });

  it("retries a persisted failed export without asking the renderer to run again", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const failed = {
      id: "video-export-retry",
      assetId: product.backendAssetId!,
      status: "failed" as const,
      stage: "failed" as const,
      retryable: true,
      errorMessage: "检查服务暂时不可用",
      qualityReport: null,
      mp4Ref: null,
      exportVariant: "original" as const,
      brandSpecVersion: null,
    };
    const completed = {
      ...failed,
      status: "completed" as const,
      stage: "done" as const,
      retryable: false,
      errorMessage: null,
      qualityReport: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
      mp4Ref: "local://exports/recovered.mp4",
    };
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(failed);
    const retry = vi.spyOn(assetWorkspaceAdapter, "retryVideoExport").mockResolvedValue({
      ...failed,
      status: "queued",
      stage: "uploaded",
      errorMessage: null,
    });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockResolvedValue(completed);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue(
      conversationForDisplayProduct(product) as never,
    );
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new TextEncoder().encode("mp4"), { status: 200 }),
    ));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:retried-export"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const onProductUpdated = vi.fn();

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={onProductUpdated}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    await screen.findByRole("button", { name: "导出视频" });
    chooseVideoExport();
    await waitFor(() => expect(retry).toHaveBeenCalledWith(
      "token",
      product.backendAssetId,
      failed,
    ));
    await waitFor(() => expect(onProductUpdated).toHaveBeenCalledTimes(1));
    expect(screen.queryByTitle("视频剪辑器")).not.toBeInTheDocument();
  });

  it("shows the latest quality findings when a persisted export retry fails", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const failed = {
      id: "video-export-retry-failed",
      assetId: product.backendAssetId!,
      status: "failed" as const,
      stage: "failed" as const,
      retryable: true,
      errorMessage: "成片检查失败",
      qualityReport: null,
      mp4Ref: null,
      exportVariant: "original" as const,
      brandSpecVersion: null,
    };
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(failed);
    vi.spyOn(assetWorkspaceAdapter, "retryVideoExport").mockResolvedValue({
      ...failed,
      status: "queued",
      stage: "uploaded",
    });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockResolvedValue({
      ...failed,
      retryable: false,
      qualityReport: {
        stage: "export_file",
        status: "blocked",
        blockers: [{
          code: "audio_tail_exceeds_video",
          segment_id: null,
          object_type: "export_file",
          message: "导出成片音频明显晚于画面。",
          suggested_actions: ["检查音轨时长后重新导出"],
        }],
        warnings: [],
      },
    });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    await screen.findByRole("button", { name: "导出视频" });
    chooseVideoExport();
    expect(await screen.findByRole("status", { name: "视频质量检查" })).toHaveTextContent("导出成片音频明显晚于画面");
  });

  it("clears an earlier quality report when a new retry fails without one", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const report = {
      stage: "export_file",
      status: "blocked",
      blockers: [{
        code: "video_duration_unavailable",
        segment_id: null,
        object_type: "export_file",
        message: "旧任务的画面时长无法验证。",
        suggested_actions: ["重新导出"],
      }],
      warnings: [],
    };
    const failed = {
      id: "video-export-retry-without-report",
      assetId: product.backendAssetId!,
      status: "failed" as const,
      stage: "failed" as const,
      retryable: true,
      errorMessage: "检查暂时失败",
      qualityReport: report,
      mp4Ref: null,
      exportVariant: "original" as const,
      brandSpecVersion: null,
    };
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(failed);
    vi.spyOn(assetWorkspaceAdapter, "retryVideoExport").mockResolvedValue({
      ...failed,
      status: "queued",
      stage: "uploaded",
      qualityReport: null,
    });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockResolvedValue({
      ...failed,
      qualityReport: null,
      errorMessage: "检查工具不可用",
    });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(await screen.findByRole("status", { name: "视频质量检查" })).toHaveTextContent("旧任务的画面时长无法验证");
    chooseVideoExport();
    expect(await screen.findByText("检查工具不可用")).toBeVisible();
    expect(screen.queryByRole("status", { name: "视频质量检查" })).not.toBeInTheDocument();
  });

  it.each(["direct-pass", "waiting-null", "direct-warning"])("isolates the branded completion report from an earlier original failure (%s)", async (scenario) => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const original = {
      id: "original-failed", assetId: product.backendAssetId!,
      status: "failed" as const, stage: "failed" as const, retryable: true,
      errorMessage: "file_quality_blocked", mp4Ref: null,
      exportVariant: "original" as const, brandSpecVersion: null,
      qualityReport: { stage: "export_file", status: "blocked", warnings: [], blockers: [{
        code: "decode_failed", segment_id: null, object_type: "export_file",
        message: "原始版旧失败", suggested_actions: ["重新导出"],
      }] },
    };
    const brand = {
      ...original, id: "brand-completed", status: "completed" as const, stage: "done" as const,
      retryable: false, errorMessage: null, mp4Ref: "brand-completed.mp4",
      exportVariant: "brand_showcase" as const,
      qualityReport: scenario === "waiting-null" ? null : {
        stage: "export_file", status: scenario === "direct-warning" ? "warning" : "pass", blockers: [],
        warnings: scenario === "direct-warning" ? [{ code: "brand-warning", segment_id: null,
          object_type: "export_file", message: "品牌版独有提示", suggested_actions: [] }] : [],
      },
    };
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockImplementation(async (_token, _asset, variant) => {
      if (variant === "original") return original;
      return scenario === "waiting-null" ? { ...brand, status: "running", stage: "verifying" } : brand;
    });
    const wait = vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockResolvedValue(brand);
    const retry = vi.spyOn(assetWorkspaceAdapter, "retryVideoExport").mockResolvedValue({ ...original, status: "queued", stage: "uploaded" });
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue({
      ...conversationForDisplayProduct(product), product, products: [product],
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response("brand-mp4")));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:brand"), revokeObjectURL: vi.fn() });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} onProductUpdated={vi.fn()} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);
    expect(await screen.findByRole("status", { name: "视频质量检查" })).toHaveTextContent("原始版旧失败");
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(screen.queryByText("原始版旧失败")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    if (scenario === "direct-warning") expect(screen.getByRole("status", { name: "视频质量检查" })).toHaveTextContent("品牌版独有提示");
    else expect(screen.queryByRole("status", { name: "视频质量检查" })).not.toBeInTheDocument();

    wait.mockResolvedValue(original);
    chooseVideoExport();
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent("原始成片导出失败");
    expect(screen.getByRole("status", { name: "视频质量检查" })).toHaveTextContent("原始版旧失败");
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("原始版旧失败")).not.toBeInTheDocument();
    if (scenario === "direct-warning") expect(screen.getByRole("status", { name: "视频质量检查" })).toHaveTextContent("品牌版独有提示");
  });

  it.each(["version", "content-hash", "approval-fingerprint"])("invalidates cached exports when the same asset changes its %s", async (change) => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const first = { ...base, version: "v1", contentHash: "hash-1", versions: [],
      metadata: { ...base.metadata, video_project_quality_approval: { fingerprint: "fp-1" } } };
    const next = { ...first,
      version: change === "version" ? "v2" : first.version,
      contentHash: change === "content-hash" ? "hash-2" : first.contentHash,
      metadata: { ...first.metadata, video_project_quality_approval: { fingerprint: change === "approval-fingerprint" ? "fp-2" : "fp-1" } },
    };
    const job = { id: "cached-brand", assetId: base.backendAssetId!, status: "completed" as const,
      stage: "done" as const, retryable: false, errorMessage: null, qualityReport: null,
      mp4Ref: "v1-brand.mp4", exportVariant: "brand_showcase" as const, brandSpecVersion: "multimix-brand-showcase:v1" };
    const getCurrent = vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport")
      .mockResolvedValueOnce(job).mockResolvedValueOnce({ ...job, id: "new-brand", mp4Ref: "v2-brand.mp4" });
    const downloadFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response("verified-mp4"));
    vi.stubGlobal("fetch", downloadFetch);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:verified"), revokeObjectURL: vi.fn() });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined), token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} product={first} selectedConversation={conversationForDisplayProduct(first)} />);
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(getCurrent).toHaveBeenCalledOnce();
    rerender(<ProductWorkspace {...props} product={next} selectedConversation={conversationForDisplayProduct(next)} />);
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(download).toHaveBeenCalledTimes(3));
    expect(getCurrent).toHaveBeenCalledTimes(2);
    expect(downloadFetch).toHaveBeenLastCalledWith(expect.stringContaining("v2-brand.mp4"));
  });

  it.each(["completed", "failed", "running"] as const)("ignores a late original recovery while the branded operation is %s", async (brandStatus) => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const failed = { id: "late-original", assetId: product.backendAssetId!, status: "failed" as const,
      stage: "failed" as const, retryable: true, errorMessage: "旧原始版检查失败", qualityReport: null,
      mp4Ref: null, exportVariant: "original" as const, brandSpecVersion: null };
    let resolveOriginal!: (value: typeof failed) => void;
    const originalResponse = new Promise<typeof failed>((resolve) => { resolveOriginal = resolve; });
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockImplementation(async (_token, _asset, variant) => variant === "original"
      ? originalResponse : { ...failed, status: brandStatus === "failed" ? "running" : brandStatus,
        stage: brandStatus === "completed" ? "done" : "verifying", retryable: false,
        errorMessage: null, mp4Ref: "current-brand.mp4", exportVariant: "brand_showcase" });
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockImplementation(async () => {
      if (brandStatus === "failed") return { ...failed, errorMessage: "当前品牌版检查失败", exportVariant: "brand_showcase" };
      return new Promise(() => undefined);
    });
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue({ ...conversationForDisplayProduct(product), product });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response("verified")));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:brand"), revokeObjectURL: vi.fn() });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} onProductUpdated={vi.fn()} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);
    chooseVideoExport("品牌展示版");
    if (brandStatus === "completed") await waitFor(() => expect(download).toHaveBeenCalledOnce());
    else if (brandStatus === "failed") await screen.findByRole("alert");
    else await screen.findByRole("button", { name: "品牌展示版 · 正在检查" });
    await act(async () => { resolveOriginal(failed); await originalResponse; });
    if (brandStatus === "failed") expect(screen.getByRole("alert")).toHaveTextContent("当前品牌版检查失败");
    else expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    if (brandStatus === "running") expect(screen.getByRole("button", { name: "品牌展示版 · 正在检查" })).toBeDisabled();
    expect(screen.queryByText("旧原始版检查失败")).not.toBeInTheDocument();
  });

  it("does not apply a late original detail refresh after a branded download", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const staleProduct = { ...product, metadata: { ...product.metadata, mp4_ref: "old-original.mp4" } };
    const conversation = conversationForDisplayProduct(product);
    let finishRefresh!: (detail: typeof conversation) => void;
    const oldRefresh = new Promise<typeof conversation>((resolve) => { finishRefresh = resolve; });
    const loadDetail = vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail")
      .mockReturnValueOnce(oldRefresh).mockResolvedValue(conversation);
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockImplementation(async (_token, _asset, variant) => ({
      id: `${variant}-ready`, assetId: product.backendAssetId!, status: "completed", stage: "done",
      retryable: false, errorMessage: null, qualityReport: null, mp4Ref: `${variant}.mp4`,
      exportVariant: variant ?? "original", brandSpecVersion: null,
    }));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response("verified")));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:brand"), revokeObjectURL: vi.fn() });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const updateProduct = vi.fn();
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} onProductUpdated={updateProduct} product={product}
      selectedConversation={conversation} token="token" />);
    await waitFor(() => expect(loadDetail).toHaveBeenCalledOnce());
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    await waitFor(() => expect(loadDetail).toHaveBeenCalledTimes(2));
    await act(async () => { finishRefresh({ ...conversation, product: staleProduct, products: [staleProduct] }); await oldRefresh; });
    expect(updateProduct).not.toHaveBeenCalledWith(staleProduct);
  });

  it("does not download or cache an old project response after a new version arrives", async () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const first = { ...base, version: "v1", contentHash: "old-hash", versions: [] };
    const next = { ...first, version: "v2", contentHash: "new-hash" };
    const job = { id: "old-brand", assetId: base.backendAssetId!, status: "completed" as const, stage: "done" as const,
      retryable: false, errorMessage: null, qualityReport: null, mp4Ref: "old-brand.mp4",
      exportVariant: "brand_showcase" as const, brandSpecVersion: "multimix-brand-showcase:v1" };
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(job);
    let finishDownload!: (response: Response) => void;
    const downloadResponse = new Promise<Response>((resolve) => { finishDownload = resolve; });
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(downloadResponse);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:old"), revokeObjectURL: vi.fn() });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined), token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} product={first} selectedConversation={conversationForDisplayProduct(first)} />);
    chooseVideoExport("品牌展示版");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    rerender(<ProductWorkspace {...props} product={next} selectedConversation={conversationForDisplayProduct(next)} />);
    await act(async () => { finishDownload(new Response("old-file")); await downloadResponse; });
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("downloads the current branded job without using the original project MP4", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const brandJob = {
      id: "video-export-brand-current",
      assetId: product.backendAssetId!,
      status: "completed" as const,
      stage: "done" as const,
      retryable: false,
      errorMessage: null,
      qualityReport: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
      mp4Ref: "supabase://exports/brand-current.mp4",
      exportVariant: "brand_showcase" as const,
      brandSpecVersion: "multimix-brand-showcase:v1",
    };
    const getCurrent = vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(brandJob);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new TextEncoder().encode("brand-mp4"), { status: 200 }),
    ));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:brand-current"),
      revokeObjectURL: vi.fn(),
    });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    chooseVideoExport("品牌展示版");

    await waitFor(() => expect(getCurrent).toHaveBeenCalledWith(
      "token",
      product.backendAssetId,
      "brand_showcase",
    ));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("brand-current.mp4"));
  });

  it.each([false, true])("stops when a running branded export fails (retryable=%s)", async (retryable) => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const running = {
      id: "brand-running-failure", assetId: product.backendAssetId!,
      status: "running" as const, stage: "verifying" as const, retryable: false,
      errorMessage: null, qualityReport: null, mp4Ref: null,
      exportVariant: "brand_showcase" as const, brandSpecVersion: "multimix-brand-showcase:v1",
    };
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockResolvedValue(running);
    vi.spyOn(assetWorkspaceAdapter, "waitForVideoExport").mockResolvedValue({
      ...running, status: "failed", stage: "failed", retryable,
      errorMessage: "Exported video did not pass quality verification.",
      qualityReport: { stage: "export_file", status: "blocked", warnings: [], blockers: [{
        code: "decode_failed", segment_id: null, object_type: "export_file",
        message: "品牌成片无法完整解码。", suggested_actions: ["重新导出"],
      }] },
    });
    const retry = vi.spyOn(assetWorkspaceAdapter, "retryVideoExport").mockRejectedValue(new Error("unexpected retry"));
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);
    chooseVideoExport("品牌展示版");
    expect(await screen.findByRole("alert")).toHaveTextContent("品牌展示版导出失败");
    expect(screen.getByRole("alert")).toHaveTextContent("成片未通过质量检查，请查看具体问题后重新导出。");
    expect(screen.getByRole("status", { name: "视频质量检查" })).toHaveTextContent("品牌成片无法完整解码");
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
    expect(retry).not.toHaveBeenCalled();
    if (retryable) {
      retry.mockResolvedValue({ ...running, status: "queued", stage: "uploaded" });
      chooseVideoExport("品牌展示版");
      await waitFor(() => expect(retry).toHaveBeenCalledOnce());
      expect(retry).toHaveBeenCalledWith("token", product.backendAssetId,
        expect.objectContaining({ id: running.id, status: "failed" }));
    }
  });

  it("reveals retry when a live failed job overrides stale pending metadata", () => {
    const product = {
      ...displayProducts["case-05-project-failed"],
      metadata: {
        ...displayProducts["case-05-project-failed"].metadata,
        orchestration_pending: true,
      },
    };
    const retry = vi.fn(async () => undefined);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={retry}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        videoJobLive={{
          jobId: "job-failed",
          status: "failed",
          workflowStage: "video_project_failed",
          steps: [],
          errorMessage: "素材合成步骤失败，请重试。",
          completionConfirmed: false,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("视频失败");
    expect(screen.getByRole("button", { name: /重试生成/ })).toBeEnabled();
    expect(screen.queryByText("视频工程生成中")).not.toBeInTheDocument();
  });

  it("leaves recovery to the conversation timeline when the failed step has a retry id", () => {
    const product = displayProducts["case-05-project-failed"];

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        videoJobLive={{
          jobId: "job-failed-with-retry",
          status: "failed",
          workflowStage: "video_project_failed",
          steps: [{ key: "compose_audio", label: "合成配音", status: "fail", retryJobId: "retry-audio-1" }],
          errorMessage: "配音服务超时。",
          completionConfirmed: false,
          productStatus: "failed",
          productCompleted: false,
          failureAction: "retry",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("请在左侧重试失败步骤");
    expect(screen.queryByRole("button", { name: /重试生成/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("asks before finding a replacement for a confirmed missing scene asset", () => {
    const product = {
      ...displayProducts["case-05-project-failed"],
      failureReason: "第 4 镜的原素材不可用，请确认是否重新寻找该镜素材。",
      failureAction: "replace_scene_asset" as const,
      failureSceneId: "seg-4",
      backendAssetId: 440,
    };
    const retry = vi.fn(async () => undefined);
    const composerSend = vi.fn();
    window.addEventListener("multimix:composer-send", composerSend);

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={retry}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新寻找该镜素材" }));

    expect(retry).not.toHaveBeenCalled();
    expect(composerSend).toHaveBeenCalledTimes(1);
    expect((composerSend.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      utterance: "确认重新寻找该分镜的素材，并在生成视频前让我确认新版编导脚本。",
      videoSceneReplacement: {
        failedProjectAssetId: 440,
        sceneId: "seg-4",
      },
    });
    window.removeEventListener("multimix:composer-send", composerSend);
  });

  it("does not guess a failed scene id from the error sentence", () => {
    const product = {
      ...displayProducts["case-05-project-failed"],
      backendAssetId: 440,
      failureReason: "第 4 镜的原素材不可用，请确认是否重新寻找该镜素材。",
      failureAction: "replace_scene_asset" as const,
      failureSceneId: undefined,
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
      />,
    );

    expect(screen.getByRole("button", { name: "重新寻找该镜素材" })).toBeDisabled();
  });

  it("opens the selected segment voiceover editor in a dialog", () => {
    const product = {
      ...displayProducts["case-06-project-ready-no-mp4"],
      segments: displayProducts["case-06-project-ready-no-mp4"].segments?.map((segment, index) => (
        index === 0
          ? { ...segment, line: "欢迎来到我们的门店", voiceName: "male_steady" }
          : segment
      )),
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "修改配音" })[0]!);

    expect(screen.getByRole("dialog", { name: "修改分镜 #1 配音" })).toBeInTheDocument();
    expect(screen.getByLabelText("配音文本")).toHaveValue("欢迎来到我们的门店");
    expect(screen.getByRole("radio", { name: "男声 · 沉稳" })).toBeChecked();
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
  });

  it("does not show a voiceover action without authentication", () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
      />,
    );

    expect(screen.queryByRole("button", { name: "修改配音" })).not.toBeInTheDocument();
  });

  it("blocks editing and export while planned MG overlays run", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const product = {
      ...base,
      productStatus: "generating" as const,
      videoProductCompleted: false,
    };

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
        videoJobLive={{
          jobId: "main-job",
          status: "completed",
          workflowStage: "video_project_ready",
          steps: [{ key: "mg_overlay", label: "生成并添加 MG 动效", status: "run", retryJobId: null }],
          errorMessage: null,
          completionConfirmed: false,
          productStatus: "generating",
          productCompleted: false,
        }}
      />,
    );

    expect(screen.getByText("视频生成中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });

  it("restores editing and export after MG overlays render", () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
        videoJobLive={{
          jobId: "main-job",
          status: "completed",
          workflowStage: "video_project_ready",
          steps: [{ key: "mg_overlay", label: "生成并添加 MG 动效", status: "done", retryJobId: null }],
          errorMessage: null,
          completionConfirmed: true,
          productStatus: "completed",
          productCompleted: true,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
  });

  it("keeps a ready internal project failed until MG recovery, with retry but no edit/export", () => {
    const product = displayProducts["case-08-mg-failed-project-ready"];

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onRetryVideoJob={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("第 1 镜动效未能完成。");
    expect(screen.getByRole("button", { name: /重试生成/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });

  it("opens the material picker without leaving the finished-video browse surface", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const localCandidates = {
      scope: "local",
      segment_id: "segment-1",
      groups: {
        current: [],
        recommended: [{
          candidate_id: "cand-12",
          source_type: "saved_asset",
          source_asset_id: 12,
          provider: "library",
          provider_item_id: "12",
          media_type: "image",
          title: "施工过程记录",
          preview_url: "",
          width: 0,
          height: 0,
          duration: 0,
          license: "",
          author: "",
          attribution_url: "",
          verification_status: "persisted",
          relevance_status: "recommended",
          relevance_reason: "匹配施工过程",
          requires_trim: false,
          already_persisted: true,
          selectable: true,
        }],
        library: [],
        public: [],
      },
      provider_statuses: [],
      next_cursor: null,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("material-candidates") && url.includes("scope=local")) {
        return new Response(JSON.stringify(localCandidates), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("material-candidates")) {
        return new Response(JSON.stringify({ scope: "public", segment_id: "segment-1", groups: { current: [], recommended: [], library: [], public: [] }, provider_statuses: [], next_cursor: null }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "换素材" })[0]!);

    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "为分镜 #1 换素材" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /施工过程记录/ })).toBeInTheDocument());
  });

  it("refreshes the browse product after the embedded editor persists an update", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const updated = {
      ...product,
      summary: "已更新的工程摘要",
      segments: product.segments?.map((segment, index) => index === 0
        ? { ...segment, materialLabel: "更新后的施工素材" }
        : segment),
    };
    const onProductUpdated = vi.fn();
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue({
      ...conversationForDisplayProduct(updated),
      product: updated,
      products: [updated],
    });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={onProductUpdated}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-project-updated",
      });

    await waitFor(() => expect(onProductUpdated).toHaveBeenCalledWith(updated));
  });

  it("keeps the existing editing product and exposes retry when persisted refresh fails", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockRejectedValue(new Error("暂时无法读取工程"));

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={vi.fn()}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    dispatchEditorMessage({
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-project-updated",
      });

    expect(await screen.findByRole("alert")).toHaveTextContent("已保存编辑，但浏览态刷新失败");
    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试刷新" })).toBeEnabled();
  });
});
