// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type {
  AgentActionRunResponse,
  AssetMessagePlan,
} from "../lib/asset-workspace-types";

afterEach(cleanup);

const queuedAction: AgentActionRunResponse = {
  id: "agent-action-1",
  status: "queued",
  requiresConfirmation: false,
  confirmationId: null,
  assetId: 42,
  versionId: 9,
  message: "视频修改任务已提交。",
  retryable: false,
};

describe("Conversation Agent actions", () => {
  it("renders a queued action as running and never as completed", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-video",
      detailsLoaded: true,
      messages: [
        {
          role: "assistant" as const,
          text: "视频修改任务已提交。",
          agentAction: queuedAction,
          runSteps: [
            {
              key: queuedAction.id,
              label: "正在修改第 2 个分镜",
              status: "run" as const,
            },
          ],
        },
      ],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        liveAgentActionsById={{ [queuedAction.id]: queuedAction }}
      />,
    );

    expect(screen.getByText("正在修改第 2 个分镜")).toBeInTheDocument();
    expect(screen.queryByText("修改已完成")).not.toBeInTheDocument();
  });

  it("keeps a pending confirmation visible after a side question", () => {
    const plan: AssetMessagePlan = {
      kind: "agent_action_confirmation",
      title: "确认视频修改",
      status: "pending",
      fields: [
        { key: "action", label: "修改内容", value: "设置全片声音" },
      ],
      confirmLabel: "确认修改",
      confirmationId: "agent-confirm-1",
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-video",
      detailsLoaded: true,
      messages: [
        { role: "assistant" as const, text: "请确认。", plan },
        { role: "user" as const, text: "这个音色偏温暖吗？" },
        { role: "assistant" as const, text: "是偏温暖的声音。" },
      ],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole("button", { name: "确认修改" })).toBeEnabled();
  });

  it("submits the server confirmation binding from ConfirmCard", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const plan: AssetMessagePlan = {
      kind: "agent_action_confirmation",
      title: "确认视频修改",
      status: "pending",
      fields: [
        { key: "action", label: "修改内容", value: "设置全片声音" },
      ],
      confirmLabel: "确认修改",
      confirmationId: "agent-confirm-exact",
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-video",
      detailsLoaded: true,
      messages: [{ role: "assistant" as const, text: "请确认。", plan }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
    expect(onSendMessage.mock.calls[0]?.[6]).toBe("agent-confirm-exact");
  });

  it("confirms a video project without replaying the earlier video-parameter binding", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const plan: AssetMessagePlan = {
      kind: "video_project_confirmation",
      title: "视频方案",
      status: "pending",
      fields: [
        { key: "format", label: "视频形式", value: "横屏" },
        { key: "duration", label: "时长", value: "约 30 秒 · 4 个分镜" },
      ],
      confirmLabel: "确认",
      confirmUtterance: "确认，生成视频工程",
      ratioOptions: [
        { value: "16:9", label: "横屏 16:9" },
        { value: "9:16", label: "竖屏 9:16" },
      ],
      ratioDefault: "16:9",
      subtitleOptions: [
        { value: "translated_zh", label: "中文字幕" },
        { value: "source", label: "原文字幕" },
        { value: "bilingual", label: "中英双语" },
      ],
      subtitleDefault: "translated_zh",
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-video-project",
      detailsLoaded: true,
      messages: [{ role: "assistant" as const, text: "请确认视频方案。", assetId: 1194, plan }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
    expect(onSendMessage.mock.calls[0]?.[1]).toBe("确认，生成视频工程（横屏 16:9）");
    expect(onSendMessage.mock.calls[0]?.[5]).toBeUndefined();
    expect(onSendMessage.mock.calls[0]?.[12]).toBe(1194);
    expect(onSendMessage.mock.calls[0]?.[13]).toBeUndefined();
  });
});
