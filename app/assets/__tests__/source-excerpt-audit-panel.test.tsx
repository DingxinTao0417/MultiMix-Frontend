// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProductWorkspace from "../components/product-workspace";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { AssetConversation, AssetProduct } from "../lib/asset-workspace-types";

const product: AssetProduct = {
  id: "asset-1276",
  backendAssetId: 1276,
  contentType: "video_project",
  mode: "video",
  title: "原片精简工程",
  status: "已完成",
  productStatus: "completed",
  summary: "原片精简",
  ratio: "16:9",
  duration: "17 秒",
  phase: "成片",
  sections: [],
  timeline: [],
  actions: [],
  videoProjectReady: true,
  videoProductCompleted: true,
  metadata: {
    video_plan: { video_type: "source_excerpt" },
    video_project: {},
  },
};

const conversation: AssetConversation = {
  id: "asset-conversation-audit",
  title: "原片验收",
  type: "llm-generation",
  updatedAt: "刚刚",
  assetLabel: "对话产物",
  status: "active",
  prompt: "",
  response: "",
  canvasTitle: product.title,
  canvasMeta: "",
  raw: "",
  judgment: "",
  action: "",
  delivery: "",
  suggestions: [],
  messages: [],
  product,
  products: [product],
  sourceIds: [],
};

const renderWorkspace = (currentProduct = product) => render(
  <ProductWorkspace
    copied={false}
    onCopyProduct={vi.fn(async () => undefined)}
    onSaveProduct={vi.fn(async () => undefined)}
    product={currentProduct}
    selectedConversation={{ ...conversation, product: currentProduct, products: [currentProduct] }}
    token="token"
  />,
);

describe("source excerpt audit panel", () => {
  it("requests and renders only the body-free source excerpt audit", async () => {
    const getAudit = vi.spyOn(
      assetWorkspaceAdapter as unknown as { getSourceExcerptAudit: () => Promise<unknown> },
      "getSourceExcerptAudit",
    ).mockResolvedValue({
      assetId: 1276,
      projectReady: true,
      productCompleted: true,
      audit: {
        sourceAssetCount: 1,
        sourceWindowDurationSeconds: 27,
        retainedRangeCount: 2,
        retainedDurationSeconds: 17,
        removedRangeCount: 1,
        removedDurationSeconds: 10,
        hasSafeRemoval: true,
        sourceFingerprintConsistent: true,
        sourceAudioVisualSubtitleTimelineConsistent: true,
        failureCodes: [],
      },
    });

    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "核验原片精简" }));

    await waitFor(() => expect(getAudit).toHaveBeenCalledWith("token", 1276));
    expect(screen.getByText("来源窗口 27 秒")).toBeVisible();
    expect(screen.getByText("保留 2 段 / 17 秒")).toBeVisible();
    expect(screen.getByText("删减 1 段 / 10 秒")).toBeVisible();
    expect(screen.getByLabelText("原片精简核验结果")).toHaveTextContent("原声、画面、字幕时间线一致");
    expect(screen.queryByText("private source subtitle")).not.toBeInTheDocument();
  });

  it("does not offer the audit for a non-source-excerpt project", () => {
    renderWorkspace({
      ...product,
      metadata: { video_plan: { video_type: "explainer" }, video_project: {} },
    });

    expect(screen.queryByRole("button", { name: "核验原片精简" })).not.toBeInTheDocument();
  });
});
