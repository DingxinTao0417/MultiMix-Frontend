// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

describe("ConversationStart primary video tasks", () => {
  it("shows three ways to start and six composable capabilities without duplicate example cards", () => {
    const onSend = vi.fn(async () => undefined);
    render(
      <ConversationStart
        suggestions={[]}
        conversation={assetWorkspaceAdapter.getNewConversation()}
        onSend={onSend}
      />,
    );

    expect(screen.getByRole("heading", { name: "新建视频项目" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "可组合的视频制作能力" })).toHaveTextContent(
      "我的素材AI 生成镜头公开素材字幕、图文与图形动画原片优化、配音与音乐",
    );
    expect(screen.getByRole("heading", { name: "你想怎么开始？" })).toBeInTheDocument();
    const startPaths = within(screen.getByRole("region", { name: "你想怎么开始？" }));
    expect(startPaths.getAllByTestId("conversation-start-goal")).toHaveLength(3);
    expect(startPaths.getByRole("button", { name: /从想法开始/ })).toHaveTextContent("说出目标，一起确定内容和画面。");
    expect(startPaths.getByRole("button", { name: /用素材创作/ })).toHaveTextContent("上传照片、人物、资料或参考片，制作新作品。");
    expect(startPaths.getByRole("button", { name: /修改现有视频/ })).toHaveTextContent("上传原片，说明要保留和调整的部分。");
    expect(screen.queryByTestId("conversation-start-example")).not.toBeInTheDocument();
    expect(screen.queryByText("制作讲解型视频")).not.toBeInTheDocument();
    expect(screen.queryByText("优化真人口播视频")).not.toBeInTheDocument();

    fireEvent.click(startPaths.getByRole("button", { name: /用素材创作/ }));

    expect(screen.getByLabelText("输入对话内容")).toHaveValue(
      "我想用素材或参考片制作一条新视频。请先问我会提供哪些照片、人物、资料或参考片，确认各自的用途，再讨论内容和画面方案。",
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(startPaths.getByRole("button", { name: /用素材创作/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(startPaths.getByRole("button", { name: /修改现有视频/ }));

    expect(screen.getByLabelText("输入对话内容")).toHaveValue(
      "我想修改一条现有视频。请先让我提供原片，并确认要保留什么、调整什么，再讨论修改方案。",
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(startPaths.getByRole("button", { name: /修改现有视频/ })).toHaveAttribute("aria-pressed", "true");
    expect(startPaths.getByRole("button", { name: /用素材创作/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts an idea-only conversation without attachments or automatic submission", () => {
    const onSend = vi.fn(async () => undefined);
    const conversation = assetWorkspaceAdapter.getNewConversation();
    render(<ConversationStart suggestions={[]} conversation={conversation} onSend={onSend} />);

    expect(screen.getByLabelText("输入对话内容")).toHaveAttribute(
      "placeholder",
      "例如：我想给新开的咖啡店做一条短视频，吸引附近的人来看看…",
    );
    fireEvent.click(within(screen.getByRole("region", { name: "你想怎么开始？" })).getByRole("button", { name: /从想法开始/ }));
    const prompt = "我想做一条新视频，先从想法开始。请先帮我明确目标，再和我讨论内容、画面，以及需要哪些素材。";
    expect(screen.getByLabelText("输入对话内容")).toHaveValue(prompt);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "本次上传资料" })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("输入对话内容"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(conversation, prompt, expect.any(AbortSignal));
  });

  it.each(["从想法开始", "用素材创作", "修改现有视频"])(
    "does not invent attached materials when choosing %s",
    (goal) => {
      const onSend = vi.fn(async () => undefined);
      render(
        <ConversationStart
          suggestions={[]}
          conversation={assetWorkspaceAdapter.getNewConversation()}
          onSend={onSend}
        />,
      );
      const startPaths = within(screen.getByRole("region", { name: "你想怎么开始？" }));
      fireEvent.click(startPaths.getByRole("button", { name: new RegExp(goal) }));
      const composer = screen.getByLabelText<HTMLTextAreaElement>("输入对话内容");
      expect(composer.value).not.toMatch(/我的素材|我提供的素材|我上传的/);
      expect(composer.value).toContain("我想");
      expect(onSend).not.toHaveBeenCalled();
    },
  );

  it("explains that entry cards are starting points instead of fixed types", () => {
    render(
      <ConversationStart
        suggestions={[]}
        conversation={assetWorkspaceAdapter.getNewConversation()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "这些会限制制作方式吗？" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "入口只会填入一段可编辑的需求，不会锁定视频类型、模型或制作工具。",
    );
  });
});
