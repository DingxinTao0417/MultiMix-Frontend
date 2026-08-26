// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { ProductArtifact } from "../lib/asset-workspace-shared";

afterEach(cleanup);

const product = {
  id: "product-42",
  backendAssetId: 42,
  title: "daniel-vertical-english · 口播清理",
  phase: "编导脚本",
  status: "完成",
  version: "v1",
  mode: "copy",
} as ProductArtifact;

describe("conversation generation card order", () => {
  it("shows each workflow status only inside its card", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-generation-order",
      detailsLoaded: true,
      messages: [{
        id: 101,
        role: "assistant" as const,
        text: "内容生成任务已重新进入队列。",
        metadata: {
          asset_generation_job_id: "asset-generation-job-1",
          asset_generation_status: "queued",
        },
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.queryByText("内容生成任务已重新进入队列。")).not.toBeInTheDocument();
    expect(screen.getAllByText("内容生成已排队")).toHaveLength(1);
  });

  it("places the generated product before follow-up suggestions", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-generation-result",
      detailsLoaded: true,
      product,
      products: [product],
      messages: [{
        id: 102,
        role: "assistant" as const,
        text: "编导脚本已生成，可确认或修改。",
        assetId: 42,
        suggestions: ["确认默认清理"],
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={product}
        onSelectProduct={vi.fn()}
      />,
    );

    const productTitle = screen.getByText("daniel-vertical-english · 口播清理");
    const suggestion = screen.getByRole("button", { name: "确认默认清理" });
    expect(productTitle.compareDocumentPosition(suggestion) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
