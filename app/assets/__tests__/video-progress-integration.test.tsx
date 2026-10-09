// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as WorkspaceClient from "../components/assets-workspace-client";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter, type VideoJobResult } from "../lib/asset-workspace-adapter";
import type { AgentActionRunResponse, AssetConversationMessage } from "../lib/asset-workspace-types";

afterEach(cleanup);

function videoConversation(message: AssetConversationMessage) {
  const base = assetWorkspaceAdapter.getNewConversation();
  const product = {
    ...base.product,
    id: "video-product-42",
    backendAssetId: 42,
    mode: "video" as const,
    contentType: "video_project",
    title: "上一稳定版本",
    status: "已完成",
    version: "v1",
    videoProjectReady: true,
  };
  return {
    ...base,
    id: "video-progress-conversation",
    detailsLoaded: true,
    product,
    products: [product],
    messages: [message],
  };
}

describe("video progress integration", () => {
  it("restores a persisted video plan purpose without relying on event labels", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "persisted-plan-progress",
      detailsLoaded: true,
      messages: [{
        role: "assistant" as const,
        text: "",
        metadata: {
          asset_generation_job_id: "plan-job-1",
          asset_generation_status: "queued",
          asset_generation_progress_kind: "video_plan",
        },
      }],
    };

    render(<ConversationStudio basePath="/app/assets" selectedConversation={conversation}
      selectedProduct={null} onSelectProduct={vi.fn()} />);

    expect(screen.getByText("视频任务已提交")).toBeInTheDocument();
    expect(screen.queryByText("内容生成进度")).not.toBeInTheDocument();
  });

  it("shows creation progress without internal steps and retries the exact failed child", () => {
    const onRetryExecution = vi.fn();
    const conversation = videoConversation({
      role: "assistant" as const,
      text: "",
      assetId: 42,
      runSteps: [{ key: "legacy", label: "旧步骤", status: "run" as const }],
    });
    render(<ConversationStudio basePath="/app/assets" selectedConversation={conversation}
      selectedProduct={conversation.product} onSelectProduct={vi.fn()}
      liveRunStateByAssetId={{ 42: {
        jobId: "main-video-job", status: "failed", progressKind: "video_create",
        steps: [{ key: "provider_voice", label: "Provider 配音失败", status: "fail", retryJobId: "voice-child-job" }],
        errorMessage: "配音生成失败，可以重试。", completionConfirmed: true,
        failureAction: "retry",
      } }}
      onRetryExecution={onRetryExecution} />);

    expect(screen.getByText("视频制作未完成")).toBeInTheDocument();
    expect(screen.getByText("配音生成失败，可以重试。")).toBeInTheDocument();
    expect(screen.queryByText("Provider 配音失败")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetryExecution).toHaveBeenCalledExactlyOnceWith("voice-child-job", "main-video-job");
  });

  it("keeps project video cost evidence in the real execution stage details", () => {
    const conversation = videoConversation({
      role: "assistant" as const, text: "", assetId: 42,
      runSteps: [{ key: "legacy", label: "旧步骤", status: "run" as const }],
    });
    render(<ConversationStudio basePath="/app/assets" selectedConversation={conversation}
      selectedProduct={conversation.product} onSelectProduct={vi.fn()}
      liveRunStateByAssetId={{ 42: {
        jobId: "main-video-job", status: "running", progressKind: "video_create",
        steps: [{ key: "video", label: "正在生成视频", status: "run" }],
        errorMessage: null, completionConfirmed: false,
        imageToVideoCostSummary: {
          recordedCallCount: 1, pricedCallCount: 1, unknownCostCallCount: 0,
          standardPriceCostCny: 0.75, historicalCoverage: "since_ledger_enabled",
        },
        narrationUsageSummary: {
          recordedCallCount: 1, knownUsageCallCount: 1, unknownUsageCallCount: 0,
          billedTextWords: 12, historicalCoverage: "since_ledger_enabled",
          scope: "main_project_narration",
        },
      } }} />);
    expect(screen.getByText("正在制作视频")).toBeInTheDocument();
    expect(screen.queryByText(/图生视频已记录 1 次调用.*¥0\.75/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    expect(screen.getByText(/图生视频已记录 1 次调用.*¥0\.75/)).toBeInTheDocument();
    expect(screen.getByText(/主工程配音已记录 1 次调用.*12 个计费字符/)).toBeInTheDocument();
  });

  it("shows a failed video update while keeping the previous stable product available", () => {
    const action: AgentActionRunResponse = {
      id: "update-action-1", status: "failed", requiresConfirmation: false,
      confirmationId: null, assetId: 42, versionId: 3,
      message: "这次调整没有完成，上一版本仍可使用。", retryable: false,
    };
    const conversation = videoConversation({
      role: "assistant" as const, text: "", assetId: 42, agentAction: action,
      runSteps: [{ key: "internal_revision", label: "内部版本处理", status: "fail" as const }],
    });
    render(<ConversationStudio basePath="/app/assets" selectedConversation={conversation}
      selectedProduct={conversation.product} onSelectProduct={vi.fn()}
      liveAgentActionsById={{ [action.id]: action }} onRetryAgentAction={vi.fn()} />);

    expect(screen.getByText("本次修改未完成")).toBeInTheDocument();
    expect(screen.getByText(action.message)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /视频工程.*v1.*已完成/ }))
      .toHaveAttribute("href", "/app/assets?conversation=video-progress-conversation&product=video-product-42");
    expect(screen.queryByText("内部版本处理")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("uses a neutral status for a canceled video update", () => {
    const action: AgentActionRunResponse = {
      id: "update-action-canceled", status: "canceled", requiresConfirmation: false,
      confirmationId: null, assetId: 42, versionId: 3,
      message: "已停止本次修改。", retryable: true,
    };
    const conversation = videoConversation({
      role: "assistant" as const, text: "", assetId: 42, agentAction: action,
      runSteps: [{ key: action.id, label: "内部取消", status: "fail" as const }],
    });
    render(<ConversationStudio basePath="/app/assets" selectedConversation={conversation}
      selectedProduct={conversation.product} onSelectProduct={vi.fn()}
      liveAgentActionsById={{ [action.id]: action }} onRetryAgentAction={vi.fn()} />);

    expect(screen.getByText("本次任务已停止")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
  });

  it("projects creation/update identity and connection loss without changing the job", () => {
    const client = WorkspaceClient as unknown as {
      videoJobLiveStatusFromResult?: (job: VideoJobResult) => Record<string, unknown>;
      markExecutionConnectionLost?: (
        current: Record<number, Record<string, unknown>>, jobId: string,
      ) => Record<number, Record<string, unknown>>;
    };
    expect(client.videoJobLiveStatusFromResult).toBeTypeOf("function");
    expect(client.markExecutionConnectionLost).toBeTypeOf("function");
    if (!client.videoJobLiveStatusFromResult || !client.markExecutionConnectionLost) return;
    const job: VideoJobResult = {
      id: "update-job", assetId: 42, status: "completed", workflowStage: "completed",
      steps: [], errorMessage: null, project: {}, productStatus: "completed",
      productCompleted: true, operationStatus: "failed",
      imageToVideoCostSummary: {
        recordedCallCount: 1, pricedCallCount: 0, unknownCostCallCount: 1,
        standardPriceCostCny: 0, historicalCoverage: "since_ledger_enabled",
      },
      operationFailureReason: "修改失败，稳定版本保留。", operationFailureAction: "retry",
    };
    const live = client.videoJobLiveStatusFromResult(job);
    expect(live).toMatchObject({ jobId: "update-job", progressKind: "video_update", connectionLost: false });
    expect(live.imageToVideoCostSummary).toMatchObject({ unknownCostCallCount: 1 });
    const current = { 42: live };
    const marked = client.markExecutionConnectionLost(current, "update-job");
    expect(marked[42]).toMatchObject({ jobId: "update-job", connectionLost: true });
    expect(current[42].connectionLost).toBe(false);
  });
});
