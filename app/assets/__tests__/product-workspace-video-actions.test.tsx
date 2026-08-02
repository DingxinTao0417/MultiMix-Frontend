// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("video browse actions", () => {
  it("restores download for an already persisted MP4 without exporting again", async () => {
    const product = displayProducts["case-07-project-ready-mp4"];
    const getVideoQuality = vi.spyOn(assetWorkspaceAdapter, "getVideoQuality");
    let downloadedHref = "";
    const downloadFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(["mp4"]), { status: 200 }));
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
          renderStage: "failed",
          steps: [],
          errorMessage: "素材合成步骤失败，请重试。",
          completionConfirmed: false,
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("视频生成失败");
    expect(screen.getByRole("button", { name: /重试生成/ })).toBeEnabled();
    expect(screen.queryByText("视频工程生成中")).not.toBeInTheDocument();
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

  it("keeps preview and editing available while planned MG overlays run", () => {
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
          renderStage: "done",
          steps: [{ key: "mg_overlay", label: "生成并添加 MG 动效", status: "run", elapsedSeconds: null, retryJobId: null }],
          errorMessage: null,
          completionConfirmed: false,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled();
    expect(screen.queryByTitle("视频剪辑器")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByTitle("视频剪辑器")).toBeInTheDocument();
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
