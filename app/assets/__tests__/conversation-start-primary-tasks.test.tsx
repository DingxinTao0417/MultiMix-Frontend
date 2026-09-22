// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

describe("ConversationStart primary video tasks", () => {
  it("shows four goals, idea/image/video starts and six composable capabilities", () => {
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
      "我的素材AI 生成镜头公开素材图形动画口播优化配音与音乐",
    );
    expect(screen.getAllByTestId("conversation-start-goal")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /讲清楚/ })).toHaveTextContent("概念、过程或结果");
    expect(screen.getByRole("button", { name: /推广产品/ })).toHaveTextContent("商品、服务或品牌");
    expect(screen.getByRole("button", { name: /讲个故事/ })).toHaveTextContent("人物、物品或过程");
    expect(screen.getByRole("button", { name: /优化已有视频/ })).toHaveTextContent("保留主体和原声");
    expect(screen.getAllByTestId("conversation-start-example")).toHaveLength(3);
    expect(screen.queryByText("制作讲解型视频")).not.toBeInTheDocument();
    expect(screen.queryByText("优化真人口播视频")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /推广产品/ }));

    expect(screen.getByLabelText("输入对话内容")).toHaveValue(
      "我想做一条推广产品或品牌的短视频。请先帮我明确目标用户和核心卖点，再规划有吸引力的表达方式。",
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /推广产品/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /只有一段原视频/ }));

    expect(screen.getByLabelText("输入对话内容")).toHaveValue(
      "我想优化一段真人口播，保留原声和人物主体。请先讨论如何改善节奏，再确认原片中哪些内容可以删减。",
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /只有一段原视频/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /推广产品/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /只有一张图片/ })).not.toHaveClass("featured");
  });

  it("starts an idea-only conversation without attachments or automatic submission", () => {
    const onSend = vi.fn(async () => undefined);
    const conversation = assetWorkspaceAdapter.getNewConversation();
    render(<ConversationStart suggestions={[]} conversation={conversation} onSend={onSend} />);

    expect(screen.getByLabelText("输入对话内容")).toHaveAttribute(
      "placeholder",
      "例如：我想给新开的咖啡店做一条短视频，吸引附近的人来看看…",
    );
    fireEvent.click(screen.getByRole("button", { name: /只有一个想法/ }));
    const prompt = "我想给新开的咖啡店做一条短视频，目前只有一个想法，还没有图片或视频。请先和我讨论创作方向。";
    expect(screen.getByLabelText("输入对话内容")).toHaveValue(prompt);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "本次上传资料" })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("输入对话内容"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(conversation, prompt, expect.any(AbortSignal));
  });

  it.each(["讲清楚", "推广产品", "讲个故事", "优化已有视频"])(
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
      fireEvent.click(screen.getByRole("button", { name: new RegExp(goal) }));
      const composer = screen.getByLabelText<HTMLTextAreaElement>("输入对话内容");
      expect(composer.value).not.toMatch(/我的素材|我提供的素材|我上传的/);
      expect(composer.value).toContain("我想");
      expect(onSend).not.toHaveBeenCalled();
    },
  );

  it("explains that goals are starting points instead of fixed types", () => {
    render(
      <ConversationStart
        suggestions={[]}
        conversation={assetWorkspaceAdapter.getNewConversation()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "这些会限制制作方式吗？" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "目标和示例只会填入一段可编辑的需求，不会锁定视频类型、模型或制作工具。",
    );
  });
});
