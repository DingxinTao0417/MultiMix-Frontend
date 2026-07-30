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
  taskId: "task-video",
  actionId: "video.scene.replace_material",
  status: "queued",
  target: {
    scope: "scene",
    asset_id: 42,
    version_id: 9,
    scene_id: "scene-2",
  },
  requiresConfirmation: false,
  confirmationId: null,
  confirmationReason: null,
  jobId: "video-job-1",
  assetId: 42,
  versionId: 9,
  message: "视频修改任务已提交。",
  errorCode: null,
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
});
