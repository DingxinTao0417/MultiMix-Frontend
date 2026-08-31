// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { ProductArtifact } from "../lib/asset-workspace-shared";
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
  it("shows a single-image creative draft as nonblocking and lets users fill missing details", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-single-image-creative-draft",
      detailsLoaded: true,
      messages: [{
        role: "assistant" as const,
        text: "已生成编导稿。",
        assetId: 810,
        metadata: {
          creative_draft: {
            status: "needs_information",
            title: "创意草稿 · 待补信息",
            message: "已按可见画面起草，可直接继续生成；补充信息后可提升准确性。",
            missing_items: ["产品名称/型号", "核心卖点", "使用场景"],
            release_status: "not_ready",
            release_note: "补充信息并完成人工审阅前，不能作为公开发布依据。",
          },
        },
        suggestionActions: [
          { id: "creative-draft-name", label: "补充产品名称/型号", utterance: "补充产品名称/型号", actionType: "fill_composer", enabled: true, isAiPrimary: false, requiresConfirmation: false },
          { id: "creative-draft-benefit", label: "补充核心卖点", utterance: "补充核心卖点", actionType: "fill_composer", enabled: true, isAiPrimary: false, requiresConfirmation: false },
          { id: "creative-draft-scenario", label: "补充使用场景", utterance: "补充使用场景", actionType: "fill_composer", enabled: true, isAiPrimary: false, requiresConfirmation: false },
        ],
      }],
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

    expect(screen.getByLabelText("创意草稿状态")).toHaveTextContent("创意草稿 · 待补信息");
    expect(screen.getByText("产品名称/型号")).toBeInTheDocument();
    expect(screen.getByText("核心卖点")).toBeInTheDocument();
    expect(screen.getByText("使用场景")).toBeInTheDocument();
    expect(screen.getByText(/可直接继续生成/)).toBeInTheDocument();
    expect(screen.queryByText("可公开发布")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "补充核心卖点" }));
    expect(screen.getByRole("textbox")).toHaveValue("补充核心卖点");
  });

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
    expect(onSendMessage.mock.calls[0]?.[13]).toBe(1194);
    expect(onSendMessage.mock.calls[0]?.[14]).toBeUndefined();
  });

  it("submits an explicit source subtitle choice on the initial video confirmation", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const plan: AssetMessagePlan = {
      kind: "video_project_confirmation",
      title: "视频方案",
      status: "pending",
      fields: [
        { key: "format", label: "视频形式", value: "横屏" },
        { key: "duration", label: "时长", value: "约 18 秒 · 2 个分镜" },
      ],
      confirmLabel: "确认",
      confirmUtterance: "确认，生成视频工程",
      ratioOptions: [{ value: "16:9", label: "横屏 16:9" }],
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
      id: "conversation-source-subtitle",
      detailsLoaded: true,
      messages: [{ role: "assistant" as const, text: "请确认视频方案。", assetId: 1298, plan }],
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

    fireEvent.click(screen.getByRole("radio", { name: "原文字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
    expect(onSendMessage.mock.calls[0]?.[13]).toBe(1298);
    expect(onSendMessage.mock.calls[0]?.[14]).toBe("source");
  });

  it("keeps legacy video-parameter cards confirmable without backfilling an AI voice choice", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const plan: AssetMessagePlan = {
      kind: "video_parameter_confirmation",
      title: "确认视频参数",
      status: "pending",
      fields: [
        { key: "ratio", label: "视频比例", value: "横屏 16:9（默认）" },
        { key: "duration", label: "目标时长", value: "30 秒（默认）" },
      ],
      confirmLabel: "确认参数并生成编导稿",
      ratioOptions: [{ value: "16:9", label: "横屏 16:9" }],
      ratioDefault: "16:9",
      durationSeconds: 30,
      durationMin: 5,
      durationMax: 120,
      pendingIntentId: "legacy-pending",
      pendingIntentVersion: 4,
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-legacy-video-parameters",
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

    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onSendMessage.mock.calls[0]?.[5]).toEqual({
      pendingIntentId: "legacy-pending",
      version: 4,
      ratio: "16:9",
      targetSeconds: 30,
    });
  });

  it("does not expose an unbound generic confirmation while Presenter cleanup is pending", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const cleanupPlan: AssetMessagePlan = {
      kind: "presenter_cleanup_confirmation",
      title: "口播清理",
      status: "pending",
      fields: [{ key: "cleanup", label: "自然精简", value: "自动 1 项" }],
      confirmLabel: "确认清理并进入导演方案",
      cleanupPlanId: "cleanup-current",
      cleanupPlanHash: "a".repeat(64),
      cleanupItems: [{
        id: "cleanup-item-1",
        state: "auto",
        category: "non_lexical_filler",
        spokenText: "嗯",
        action: "delete",
        reason: "孤立口癖",
        estimatedSavingSeconds: 0.4,
        risk: "low",
        audioRisk: "low",
        visualJumpRisk: "low",
        protectionReasons: [],
        selected: true,
        locked: false,
      }],
      audioTrackDefault: 1,
      audioTrackOptions: [{
        streamIndex: 1,
        label: "人声轨 1",
        previewUrl: "",
        qualityScore: 0.9,
        recommended: true,
        channels: 1,
        codec: "aac",
      }],
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-presenter-cleanup",
      detailsLoaded: true,
      messages: [
        {
          role: "assistant" as const,
          text: "旧建议",
          suggestionActions: [{
            id: "generic-confirm",
            label: "确认生成",
            utterance: "确认",
            actionType: "submit_message",
            enabled: true,
            requiresConfirmation: false,
          }],
        },
        { role: "assistant" as const, text: "请确认清理方案。", assetId: 501, plan: cleanupPlan },
      ],
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

    expect(screen.queryByRole("button", { name: "确认生成" })).not.toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "确认清理并进入导演方案" });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onSendMessage.mock.calls[0]?.[11]).toEqual({
      cleanupPlanId: "cleanup-current",
      cleanupPlanHash: "a".repeat(64),
      selectedCandidateIds: ["cleanup-item-1"],
      protectedOverrideCandidateIds: [],
      confirmProtectedOverride: false,
      audioStreamIndex: 1,
    });
    expect(onSendMessage.mock.calls[0]?.[13]).toBe(501);
  });

  it("hides obsolete suggestion actions from an already confirmed card", () => {
    const confirmedCleanupPlan: AssetMessagePlan = {
      kind: "presenter_cleanup_confirmation",
      title: "口播清理",
      status: "confirmed",
      fields: [{ key: "cleanup", label: "自然精简", value: "已确认" }],
      confirmLabel: "确认清理并进入导演方案",
      cleanupPlanId: "cleanup-confirmed",
      cleanupPlanHash: "b".repeat(64),
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-confirmed-presenter-cleanup",
      detailsLoaded: true,
      messages: [{
        role: "assistant" as const,
        text: "口播清理已确认。",
        plan: confirmedCleanupPlan,
        suggestionActions: [{
          id: "stale-adjust",
          label: "调整包装强度",
          utterance: "调整包装强度",
          actionType: "fill_composer",
          enabled: true,
          requiresConfirmation: false,
        }],
      }],
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

    expect(screen.queryByRole("button", { name: "调整包装强度" })).not.toBeInTheDocument();
  });

  it("does not attach an unbound product to the last assistant message", () => {
    const orphanedProduct = {
      id: "orphaned-director-script",
      backendAssetId: 902,
      title: "旧编导稿",
      phase: "编导脚本",
      status: "完成",
      version: "v1",
      mode: "copy",
    } as ProductArtifact;
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-orphaned-product",
      detailsLoaded: true,
      products: [orphanedProduct],
      messages: [
        { role: "assistant" as const, text: "已进入视频工程。", assetId: 903 },
      ],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.queryByText("旧编导稿")).not.toBeInTheDocument();
  });

  it("marks a director script as used only when its linked video project is ready", () => {
    const readyProject: ProductArtifact = {
      id: "ready-video-project",
      backendAssetId: 903,
      title: "已生成的视频工程",
      phase: "视频",
      status: "生成中",
      version: "v1",
      mode: "video",
      contentType: "video_project",
      videoProjectReady: true,
      metadata: { director_script_asset_id: 901 },
      summary: "视频工程已生成。",
      ratio: "16:9",
      duration: "30秒",
      sections: [],
      timeline: [],
      actions: [],
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-director-script-used",
      detailsLoaded: true,
      products: [readyProject],
      messages: [{
        role: "assistant" as const,
        text: "编导稿已生成。",
        assetId: 901,
        metadata: {
          asset_generation_job_id: "director-script-job",
          asset_generation_status: "completed",
          asset_generation_progress: [
            { key: "structuring_director_script", label: "正在整理编导稿", status: "completed", occurred_at: "2026-08-31T08:00:00Z" },
            { key: "completed", label: "编导稿已生成", status: "completed", occurred_at: "2026-08-31T08:00:01Z" },
          ],
        },
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.getByText(/编导稿已确认，已用于生成视频工程/)).toBeInTheDocument();
    expect(screen.queryByText(/编导脚本已生成，可确认或修改/)).not.toBeInTheDocument();
  });

  it("requests the next Presenter direction only after the explicit single-winner action", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const plan: AssetMessagePlan = {
      kind: "presenter_project_confirmation",
      title: "口播型方案",
      status: "pending",
      fields: [{ key: "directions", label: "导演方向", value: "系统推荐 1 个方案" }],
      confirmLabel: "确认推荐方案并生成视频",
      adjustLabel: "换个方向",
      directionOptions: [{
        id: "direction-a",
        label: "推荐方向",
        concept: "人物主导",
        reason: "主体清晰",
        recommended: true,
        sampleUrl: "/preview/a.mp4",
        durationSeconds: 2.5,
      }],
      directionDefault: "direction-a",
      recommendationMode: "single_winner",
    };
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-presenter-direction",
      detailsLoaded: true,
      messages: [{
        role: "assistant" as const,
        text: "请确认推荐方案。",
        assetId: 1501,
        plan,
      }],
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

    expect(screen.queryByRole("radiogroup", { name: "口播导演方向" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "换个方向" }));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onSendMessage.mock.calls[0]?.[1]).toBe("换个方向");
    expect(onSendMessage.mock.calls[0]?.[10]).toEqual({
      currentCandidateId: "direction-a",
    });
    expect(onSendMessage.mock.calls[0]?.[13]).toBe(1501);
  });
});
