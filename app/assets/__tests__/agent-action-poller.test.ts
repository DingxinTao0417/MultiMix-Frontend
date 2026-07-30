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
  task_id: "task-video",
  action_id: "video.scene.replace_material",
  status: "queued",
  target: {
    scope: "scene",
    asset_id: 42,
    version_id: 9,
    scene_id: "scene-2",
  },
  requires_confirmation: false,
  confirmation_id: null,
  confirmation_reason: null,
  job_id: "video-job-1",
  asset_id: 42,
  version_id: 9,
  message: "视频修改任务已提交。",
  error_code: null,
  retryable: false,
};

function conversationRow(): AssetConversationResponse {
  const now = "2026-07-30T08:00:00Z";
  return {
    id: "conversation-agent",
    title: "产品视频",
    status: "active",
    metadata: {
      agent_mission: {
        version: "agent_v2",
        active_task_id: "task-video",
        task_stack: ["task-copy"],
        tasks: {
          "task-video": {
            id: "task-video",
            goal: "修改产品视频",
            status: "running",
            focus: {
              artifact_type: "video_render",
              asset_id: 42,
              version_id: 9,
              scene_id: "scene-2",
              source_buffer_id: null,
            },
            plan: [
              {
                id: queuedAction.id,
                request: {
                  action_id: queuedAction.action_id,
                  task_id: queuedAction.task_id,
                  target: queuedAction.target,
                  parameters: { source_asset_id: 77 },
                  reference_asset_ids: [77],
                  expected_version_id: 9,
                  idempotency_key: "a".repeat(64),
                  reason_summary: "",
                },
                status: "queued",
                confirmation_id: null,
                job_id: queuedAction.job_id,
                attempts: 0,
                last_observation: {
                  status: "queued",
                  action_run_id: queuedAction.id,
                  action_id: queuedAction.action_id,
                  asset_id: 42,
                  version_id: null,
                  job_id: queuedAction.job_id,
                  error_code: null,
                  retryable: false,
                  message: queuedAction.message,
                  result: {},
                },
                final_message_persisted: false,
              },
            ],
            pending_action_id: null,
            running_action_id: queuedAction.id,
            last_observation: {},
            working_context: {},
            return_to_task_id: null,
            created_at: now,
            updated_at: now,
          },
          "task-copy": {
            id: "task-copy",
            goal: "优化商品标题",
            status: "paused",
            focus: {
              artifact_type: "copy",
              asset_id: 7,
              version_id: 3,
              scene_id: null,
              source_buffer_id: null,
            },
            plan: [],
            pending_action_id: null,
            running_action_id: null,
            last_observation: {},
            working_context: {},
            return_to_task_id: null,
            created_at: now,
            updated_at: now,
          },
        },
        pending_intent: null,
        tool_runs: [],
        folded_context: {},
        last_read_only_branch: "",
      },
    },
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
  it("maps active and paused tasks from agent_mission v2", () => {
    const conversation = conversationFromPersisted(
      conversationRow(),
      assetWorkspaceAdapter.getNewConversation().product,
    );

    expect(conversation.agentTasks?.active?.id).toBe("task-video");
    expect(conversation.agentTasks?.paused.map((task) => task.id)).toEqual([
      "task-copy",
    ]);
    expect(conversation.activeAgentAction?.id).toBe(queuedAction.id);
    expect(conversation.messages?.[0]?.runSteps?.[0]?.status).toBe("run");
  });

  it("ignores legacy or malformed mission metadata", () => {
    const legacy = conversationRow();
    legacy.metadata.agent_mission = {
      version: "agent_v1",
      active_task_id: "task-video",
      tasks: "not-a-task-map",
    };

    const conversation = conversationFromPersisted(
      legacy,
      assetWorkspaceAdapter.getNewConversation().product,
    );

    expect(conversation.agentTasks).toBeUndefined();
    expect(conversation.activeAgentAction).toBeUndefined();
  });

  it("uses the mission observation instead of a stale queued message", () => {
    const completed = conversationRow();
    const mission = completed.metadata.agent_mission as {
      tasks: Record<string, { plan: Array<Record<string, unknown>> }>;
    };
    mission.tasks["task-video"].plan[0] = {
      ...mission.tasks["task-video"].plan[0],
      status: "succeeded",
      last_observation: {
        status: "succeeded",
        action_run_id: queuedAction.id,
        action_id: queuedAction.action_id,
        asset_id: 42,
        version_id: 10,
        job_id: queuedAction.job_id,
        error_code: null,
        retryable: false,
        message: "视频修改已完成。",
        result: {},
      },
    };

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
