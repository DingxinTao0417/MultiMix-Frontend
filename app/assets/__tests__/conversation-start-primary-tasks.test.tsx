// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

describe("ConversationStart primary video tasks", () => {
  it("shows four goals, three material starts and six composable capabilities", () => {
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
      "推广一个产品或品牌。请结合我的素材与目标用户，设计有吸引力但不过度广告化的视频。",
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /推广产品/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /只有一段原视频/ }));

    expect(screen.getByLabelText("输入对话内容")).toHaveValue(
      "优化我上传的真人口播，保留原声和人物主体，压缩停顿与重复内容，并补充相关产品画面。",
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /只有一段原视频/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /推广产品/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /只有一张图片/ })).not.toHaveClass("featured");
  });

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
