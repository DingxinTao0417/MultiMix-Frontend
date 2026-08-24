// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("video browse actions", () => {
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

    const downloadButton = screen.getByRole("button", { name: "下载成片" });
    expect(downloadButton).toBeEnabled();

    fireEvent.click(downloadButton);

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
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-ready",
      },
    }));

    fireEvent.click(await screen.findByRole("button", { name: "导出视频" }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-export" },
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

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-project-updated",
        reason: "timeline",
      },
    }));

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
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { source: "multimix-editor", assetId: product.backendAssetId, type: "multimix-editor-ready" },
    }));
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

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-flush-result",
        requestId: firstFlush.requestId,
        status: "error",
        message: "保存失败，请检查网络后重试。",
      },
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请检查网络后重试。");
    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(postMessage.mock.calls.filter(
      ([message]) => (message as { type?: string }).type === "multimix-editor-flush",
    )).toHaveLength(2));
    const retryFlush = postMessage.mock.calls.filter(
      ([message]) => (message as { type?: string }).type === "multimix-editor-flush",
    ).at(-1)?.[0] as { requestId: string };

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-flush-result",
        requestId: retryFlush.requestId,
        status: "saved",
      },
    }));

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
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-save-state",
        status: "dirty",
      },
    }));

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
    expect(await screen.findByRole("button", { name: "正在合成视频 42%" })).toBeDisabled();

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-success",
        report: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
        blob: new Blob(["fresh-mp4"], { type: "video/mp4" }),
      },
    }));

    const downloadButton = await screen.findByRole("button", { name: "下载成片" });
    expect(downloadButton).toBeEnabled();
    postMessage.mockClear();

    fireEvent.click(downloadButton);

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(downloadedHref).toBe("blob:fresh-export");
    expect(postMessage).not.toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-export" },
      window.location.origin,
    );
    expect(screen.getByRole("button", { name: "再次下载" })).toBeEnabled();
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

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-uploading",
      },
    }));
    expect(await screen.findByRole("button", { name: "正在上传成片" })).toBeDisabled();

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-export-verifying",
      },
    }));
    expect(await screen.findByRole("button", { name: "正在检查成片" })).toBeDisabled();
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

    expect(await screen.findByRole("button", { name: "正在检查成片" })).toBeDisabled();
    finish({
      id: "video-export-1",
      assetId: product.backendAssetId!,
      status: "completed",
      stage: "done",
      retryable: false,
      errorMessage: null,
      qualityReport: { stage: "export_file", status: "pass", blockers: [], warnings: [] },
      mp4Ref: "supabase://exports/final.mp4",
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

    expect(await screen.findByRole("button", { name: "正在检查成片" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "正在上传成片" })).not.toBeInTheDocument();
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
    }) => void;
    let recoverySignal: AbortSignal | undefined;
    vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport").mockImplementation(
      (_token, _assetId, signal) => new Promise((resolve, reject) => {
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
    };
    const getCurrent = vi.spyOn(assetWorkspaceAdapter, "getCurrentVideoExport")
      .mockImplementationOnce((_token, _assetId, signal) => new Promise((_resolve, reject) => {
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

    fireEvent.click(await screen.findByRole("button", { name: "导出失败，重试" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(
      "token",
      product.backendAssetId,
      failed,
    ));
    await waitFor(() => expect(onProductUpdated).toHaveBeenCalledTimes(1));
    expect(screen.queryByTitle("视频剪辑器")).not.toBeInTheDocument();
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

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-project-updated",
      },
    }));

    await waitFor(() => expect(onProductUpdated).toHaveBeenCalledWith(updated));
  });

  it("keeps the existing browse product and exposes retry when persisted refresh fails", async () => {
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

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "multimix-editor",
        assetId: product.backendAssetId,
        type: "multimix-editor-project-updated",
      },
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent("已保存编辑，但浏览态刷新失败");
    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试刷新" })).toBeEnabled();
  });
});
