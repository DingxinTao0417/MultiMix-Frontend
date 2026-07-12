// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter, conversationFromSummary } from "../lib/asset-workspace-adapter";

afterEach(cleanup);

describe("conversation detail loading", () => {
  it("shows an explicit loading state instead of an empty conversation", () => {
    const conversation = conversationFromSummary({
      id: "asset-conversation-480",
      title: "MultiMix 产品介绍短视频",
      status: "active",
      metadata: {},
      created_at: "2026-07-12T00:00:00Z",
      updated_at: "2026-07-12T00:00:00Z",
    }, assetWorkspaceAdapter.getNewConversation().product);

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在加载对话内容");
  });

  it("shows a retry action when detail loading fails", () => {
    const conversation = conversationFromSummary({
      id: "asset-conversation-480",
      title: "MultiMix 产品介绍短视频",
      status: "active",
      metadata: {},
      created_at: "2026-07-12T00:00:00Z",
      updated_at: "2026-07-12T00:00:00Z",
    }, assetWorkspaceAdapter.getNewConversation().product);
    const retry = vi.fn();

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        detailLoadError
        onRetryDetail={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("对话内容加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
