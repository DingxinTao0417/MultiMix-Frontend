// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssistantReplyPending,
  ConversationDetailSkeleton,
} from "../components/conversation-waiting-state";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

const readyConversation = {
  ...assetWorkspaceAdapter.getNewConversation(),
  detailsLoaded: true,
  messages: [{ role: "assistant" as const, text: "上一条回复" }],
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("conversation waiting states", () => {
  it("delays the history skeleton so fast loads do not flash", () => {
    const { container } = render(<ConversationDetailSkeleton />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByText("载入对话…")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("载入对话…");
    expect(container.querySelectorAll(".shadcn-prototype-conversation-skeleton-row")).toHaveLength(3);
  });

  it("shows one readable assistant status after the delay", () => {
    render(<AssistantReplyPending />);

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status")).toHaveTextContent("正在整理内容");
    expect(screen.getByRole("status")).not.toHaveTextContent("理解需求");
  });

  it("cancels the timer when pending unmounts", () => {
    const { unmount } = render(<AssistantReplyPending />);

    unmount();
    expect(() => act(() => vi.advanceTimersByTime(500))).not.toThrow();
  });

  it("shows the assistant placeholder for an ordinary empty pending message", () => {
    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={readyConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        pendingExchange={{
          id: "pending-1",
          userText: "改短一点",
          assistantText: "",
          status: "pending",
        }}
      />,
    );

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status")).toHaveTextContent("正在整理内容");
  });

  it("lets a real execution timeline own the pending state", () => {
    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={readyConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        pendingExchange={{
          id: "pending-2",
          userText: "确认生成视频工程",
          assistantText: "已确认，正在创建视频工程任务。",
          status: "pending",
          presentation: "execution_anchor",
          runSteps: [{ key: "create_job", label: "创建视频工程任务", status: "run" }],
        }}
      />,
    );

    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("正在整理内容")).not.toBeInTheDocument();
    expect(screen.getByText("创建视频工程任务")).toBeInTheDocument();
  });

  it("uses restrained waiting motion and removes bouncing dots", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const keyframesStart = css.indexOf("@keyframes shadcn-prototype-waiting-breathe");
    const keyframesEnd = css.indexOf("\n}", keyframesStart);
    const waitingKeyframes = css.slice(keyframesStart, keyframesEnd + 2);

    expect(css).toContain(".shadcn-prototype-conversation-skeleton");
    expect(css).toContain(".shadcn-prototype-assistant-waiting");
    expect(css).toContain("@keyframes shadcn-prototype-waiting-breathe");
    expect(css).toContain("animation: shadcn-prototype-waiting-breathe 1.6s");
    expect(waitingKeyframes).toContain("translateY(-1px)");
    expect(waitingKeyframes).not.toContain("translateY(-2px)");
    expect(css).not.toContain(".shadcn-prototype-typing-dots");
    expect(css).not.toContain("@keyframes shadcn-prototype-typing");
  });
});
