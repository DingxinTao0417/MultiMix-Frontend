import { describe, expect, it } from "vitest";

import { conversationFromPersisted } from "../../../lib/asset-mappers";
import type {
  AgentActionRunResponse,
  AssetConversationResponse,
} from "../../../lib/api";
import {
  agentActionPollLifecycleKey,
  agentActionPollOutcome,
  persistedAgentActions,
} from "../lib/agent-action-poller";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

const queuedAction: AgentActionRunResponse = {
  id: "agent-action-1",
  status: "queued",
  requires_confirmation: false,
  confirmation_id: null,
  asset_id: 42,
  version_id: 9,
  message: "视频修改任务已提交。",
  retryable: false,
};

function conversationRow(): AssetConversationResponse {
  const now = "2026-07-30T08:00:00Z";
  return {
    id: "conversation-agent",
    title: "产品视频",
    status: "active",
    metadata: {},
    agent_tasks: {
      active: {
        goal: "修改产品视频",
        status: "running",
        asset_id: 42,
        version_id: 9,
        scene_id: "scene-2",
      },
      paused: [{
        goal: "优化商品标题",
        status: "paused",
        asset_id: 7,
        version_id: 3,
        scene_id: null,
      }],
    },
    active_agent_action: queuedAction,
    messages: [
      {
        id: 1,
        role: "assistant",
        text: queuedAction.message,
        asset_id: null,
        metadata: {
          agent_action: queuedAction,
          agent_action_run_id: queuedAction.id,
          run_steps: [
            {
              key: queuedAction.id,
              label: "正在修改第 2 个分镜",
              status: "run",
            },
          ],
        },
        created_at: now,
      },
    ],
    products: [],
    created_at: now,
    updated_at: now,
  };
}

describe("Agent action persistence and polling", () => {
  it("maps active and paused tasks from explicit public DTOs", () => {
    const conversation = conversationFromPersisted(
      conversationRow(),
      assetWorkspaceAdapter.getNewConversation().product,
    );

    expect(conversation.agentTasks?.active?.goal).toBe("修改产品视频");
    expect(conversation.agentTasks?.paused.map((task) => task.goal)).toEqual(["优化商品标题"]);
    expect(conversation.activeAgentAction?.id).toBe(queuedAction.id);
    expect(conversation.messages?.[0]?.runSteps?.[0]?.status).toBe("run");
  });

  it("does not reconstruct tasks or actions from raw mission metadata", () => {
    const legacy = conversationRow();
    legacy.agent_tasks = undefined;
    legacy.active_agent_action = null;
    legacy.messages[0].metadata.agent_action = undefined;
    legacy.metadata.agent_mission = {
      version: "agent_v2",
      active_task_id: "task-video",
      tasks: { "task-video": { goal: "不得外发的内部任务" } },
    };

    const conversation = conversationFromPersisted(
      legacy,
      assetWorkspaceAdapter.getNewConversation().product,
    );

    expect(conversation.agentTasks).toBeUndefined();
    expect(conversation.activeAgentAction).toBeUndefined();
  });

  it("uses the explicit public action projection after completion", () => {
    const completed = conversationRow();
    const succeededAction: AgentActionRunResponse = {
      ...queuedAction,
      status: "succeeded",
      version_id: 10,
      message: "视频修改已完成。",
    };
    completed.active_agent_action = succeededAction;
    completed.messages[0].metadata.agent_action = succeededAction;

    const conversation = conversationFromPersisted(
      completed,
      assetWorkspaceAdapter.getNewConversation().product,
    );
    const entries = persistedAgentActions([conversation]);

    expect(conversation.messages?.[0]?.agentAction?.status).toBe("succeeded");
    expect(entries).toHaveLength(1);
    expect(agentActionPollLifecycleKey(entries)).toBe("");
  });

  it("keeps one pending poll per conversation and action", () => {
    const conversation = conversationFromPersisted(
      conversationRow(),
      assetWorkspaceAdapter.getNewConversation().product,
    );
    const entries = persistedAgentActions([conversation, conversation]);

    expect(entries).toHaveLength(1);
    expect(agentActionPollLifecycleKey(entries)).toBe(
      `conversation-agent::${queuedAction.id}`,
    );
  });

  it("refreshes the same asset after success without creating a conversation", () => {
    const outcome = agentActionPollOutcome({
      ...queuedAction,
      status: "succeeded",
      version_id: 10,
      message: "视频修改已完成。",
    });

    expect(outcome).toEqual({
      terminal: true,
      refreshConversation: true,
      assetId: 42,
      versionId: 10,
    });
    expect("createdConversationId" in outcome).toBe(false);
  });
});
