// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProductWorkspace from "../components/product-workspace";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { AssetProduct, AssetConversation } from "../lib/asset-workspace-types";


const product: AssetProduct = {
  id: "asset-88",
  backendAssetId: 88,
  contentType: "social_post",
  contentHash: "base-hash",
  mode: "copy",
  title: "家装服务文案",
  status: "有来源",
  summary: "家装服务文案",
  ratio: "Markdown",
  duration: "2 段",
  phase: "文案稿",
  body: ["家装服务文案", "原正文"],
  markdownBody: "# 家装服务文案\n\n原正文",
  sections: [],
  timeline: [],
  actions: [],
};

const conversation: AssetConversation = {
  id: "conversation-1",
  title: "家装服务",
  type: "llm-generation",
  updatedAt: "刚刚",
  assetLabel: "对话产物",
  status: "active",
  prompt: "",
  response: "",
  canvasTitle: product.title,
  canvasMeta: "",
  raw: product.markdownBody ?? "",
  judgment: "",
  action: "",
  delivery: "",
  suggestions: [],
  messages: [],
  product,
  products: [product],
  sourceIds: [],
};


describe("text artifact editing", () => {
  it("enters full markdown editing and saves a non-structural edit in one click", async () => {
    const updated = { ...product, contentHash: "next-hash", markdownBody: "# 家装服务文案\n\n修改后的正文" };
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockResolvedValue({ kind: "saved", product: updated });
    const onProductUpdated = vi.fn();

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={onProductUpdated}
        product={product}
        selectedConversation={conversation}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "编辑文案稿" });
    fireEvent.change(editor, { target: { value: "# 家装服务文案\n\n修改后的正文" } });
    expect(screen.getByText("有未保存修改")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(assetWorkspaceAdapter.saveTextEdit).toHaveBeenCalledWith({
      token: "token",
      product,
      body: "# 家装服务文案\n\n修改后的正文",
      acceptStructuralChange: false,
    }));
    expect(onProductUpdated).toHaveBeenCalledWith(updated);
    expect(screen.queryByRole("textbox", { name: "编辑文案稿" })).not.toBeInTheDocument();
  });

  it("keeps editing when structural validation requires an explicit new-structure save", async () => {
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit")
      .mockResolvedValueOnce({
        kind: "structural_change",
        message: "检测到分镜结构变化，原版本尚未被覆盖。",
        changes: { scene_count: { before: 4, after: 3 } },
      })
      .mockResolvedValueOnce({ kind: "saved", product: { ...product, contentHash: "next-hash" } });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={{ ...product, contentType: "video_script", phase: "编导稿" }}
        selectedConversation={conversation}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑编导稿" }), {
      target: { value: "# 家装编导稿\n\n### 1. 开场\n- 口播：新的开场" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("原版本尚未被覆盖");
    expect(screen.getByRole("button", { name: "返回修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "按新结构保存" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      acceptStructuralChange: true,
    })));
  });
});
