// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter, conversationFromSummary } from "../lib/asset-workspace-adapter";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("conversation detail loading", () => {
  it("shows a delayed neutral skeleton instead of an assistant reply", () => {
    const conversation = conversationFromSummary({
      id: "asset-conversation-480",
      title: "MultiMix 产品介绍短视频",
      status: "active",
      metadata: {},
      created_at: "2026-07-12T00:00:00Z",
      updated_at: "2026-07-12T00:00:00Z",
    }, assetWorkspaceAdapter.getNewConversation().product);

    const { container } = render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status")).toHaveTextContent("载入对话…");
    expect(container.querySelector("article.assistant.pending")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".shadcn-prototype-conversation-skeleton-row")).toHaveLength(3);
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
    expect(screen.queryByText("载入对话…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
