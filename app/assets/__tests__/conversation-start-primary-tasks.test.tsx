// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ConversationStart from "../components/conversation-start";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

describe("ConversationStart primary video tasks", () => {
  it("shows only explainer and presenter tasks, then fills a bounded user intent", () => {
    render(
      <ConversationStart
        suggestions={["制作讲解型视频", "优化真人口播视频"]}
        conversation={assetWorkspaceAdapter.getNewConversation()}
      />,
    );

    expect(screen.getByRole("heading", { name: "新建视频项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /制作讲解型视频/ })).toHaveTextContent("把概念、过程或结果讲清楚");
    expect(screen.getByRole("button", { name: /优化真人口播视频/ })).toHaveTextContent("保留原声，优化节奏和画面包装");
    expect(screen.queryByRole("button", { name: /把文档做成短视频/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /制作讲解型视频/ }));

    expect(screen.getByLabelText("输入对话内容")).toHaveValue(
      "制作一条讲解型视频，先根据我的素材和目标确认比例、时长与配音。",
    );
  });
});
