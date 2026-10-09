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

  it("keeps only the message-anchored successor card after a retry", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-generation-retry",
      detailsLoaded: true,
      messages: [{
        id: 103,
        role: "assistant" as const,
        text: "内容生成任务已重新进入队列。",
        metadata: {
          asset_generation_job_id: "asset-generation-job-retry",
          asset_generation_status: "running",
          retry_of_asset_generation_job_id: "asset-generation-job-failed",
        },
      }],
    };
    const generationJobs = [
      {
        id: "asset-generation-job-failed",
        status: "running" as const,
        result_asset_id: null,
        error_message: null,
        created_at: "2026-08-26T02:00:00Z",
        updated_at: "2026-08-26T04:00:00Z",
        started_at: "2026-08-26T02:00:00Z",
        progress_events: [],
      },
      {
        id: "asset-generation-job-retry",
        status: "running" as const,
        result_asset_id: null,
        error_message: null,
        created_at: "2026-08-26T04:00:00Z",
        updated_at: "2026-08-26T04:00:10Z",
        started_at: "2026-08-26T04:00:00Z",
        progress_events: [],
      },
    ];

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        generationJobs={generationJobs}
      />,
    );

    expect(document.querySelectorAll("[data-generation-job-id]")).toHaveLength(1);
    expect(document.querySelector('[data-generation-job-id="asset-generation-job-retry"]')).not.toBeNull();
    expect(document.querySelector('[data-generation-job-id="asset-generation-job-failed"]')).toBeNull();
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

    const productCard = screen.getByRole("link", { name: /文案.*v1.*完成/ });
    expect(productCard).toHaveAttribute("href", "/app/assets?conversation=conversation-generation-result&product=product-42");
    const suggestion = screen.getByRole("button", { name: "确认默认清理" });
    expect(productCard.compareDocumentPosition(suggestion) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it.each(["generating", "failed"] as const)("does not link to a %s record without a stable output", (productStatus) => {
    const unfinishedProduct: ProductArtifact = {
      ...product,
      contentType: "video_project",
      mode: "video",
      productStatus,
      status: productStatus === "failed" ? "失败" : "生成中",
      videoProjectReady: false,
      videoProductCompleted: false,
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: `conversation-${productStatus}`,
      detailsLoaded: true,
      product: unfinishedProduct,
      products: [unfinishedProduct],
      messages: [{
        id: 104,
        role: "assistant" as const,
        text: "任务状态仍在对话中显示。",
        assetId: 42,
      }],
    };

    render(<ConversationStudio
      basePath="/app/assets"
      selectedConversation={conversation}
      selectedProduct={unfinishedProduct}
      onSelectProduct={vi.fn()}
    />);

    expect(screen.getByText("任务状态仍在对话中显示。")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /视频工程/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("对话产物")).not.toBeInTheDocument();
  });
});
