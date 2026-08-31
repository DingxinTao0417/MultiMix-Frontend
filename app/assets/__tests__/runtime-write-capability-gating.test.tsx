// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_CONNECTION_ERROR, type AssetGenerationJobResponse } from "../../../lib/api";
import AssetsWorkspaceClient from "../components/assets-workspace-client";
import ConversationStart from "../components/conversation-start";
import ConversationStudio from "../components/conversation-studio";
import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import type { AgentActionRunResponse, AgentRunStep } from "../lib/asset-workspace-types";
import { writeConversationSummaryCache } from "../lib/conversation-summary-cache";
import {
  isRuntimeConnectionError,
  resolveRuntimeWriteCapabilities,
  type RuntimeWriteCapabilities,
  type RuntimeWriteConnectionState,
} from "../lib/runtime-write-capabilities";

const routerReplace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

function matchMediaMock(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/assets?conversation=new");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: matchMediaMock,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  routerReplace.mockReset();
});

function capabilities(
  connectionState: RuntimeWriteConnectionState,
  options: { backendConfigured?: boolean; hasToken?: boolean } = {},
): RuntimeWriteCapabilities {
  return resolveRuntimeWriteCapabilities({
    backendConfigured: options.backendConfigured ?? true,
    hasToken: options.hasToken ?? true,
    connectionState,
  });
}

function conversation() {
  return {
    ...assetWorkspaceAdapter.getNewConversation(),
    id: "conversation-1",
    detailsLoaded: true,
    readonly: false,
    suggestions: [],
  };
}

function copyRow(): LibraryRow {
  return {
    assetId: 29,
    title: "离线门禁测试文案",
    meta: "文案稿 · 已入库",
    note: "用于验证素材库创作入口。",
    kind: "copy",
    category: "文案稿",
    statusLabel: "已入库",
    updatedLabel: "刚刚",
  };
}

function generationJob(
  status: AssetGenerationJobResponse["status"],
  id = "generation-job-lly-29",
): AssetGenerationJobResponse {
  return {
    id,
    status,
    result_asset_id: null,
    error_message: status === "failed" ? "内容生成失败，可以重试。" : null,
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:05Z",
    started_at: status === "running" ? "2026-08-25T08:00:01Z" : null,
    progress_events: [],
  };
}

const failedExecutionStep: AgentRunStep = {
  key: "render_failed",
  label: "合成视频",
  status: "fail",
  retryJobId: "retry-child-job-lly-29",
};

const failedAgentAction: AgentActionRunResponse = {
  id: "agent-action-lly-29",
  status: "failed",
  requiresConfirmation: false,
  confirmationId: null,
  assetId: 91,
  versionId: null,
  message: "视频修改失败。",
  retryable: true,
};

describe("runtime write capability model", () => {
  it("fails closed for unconfigured, checking, unavailable, and missing-token states", () => {
    const unconfigured = capabilities("checking", { backendConfigured: false });
    const checking = capabilities("checking");
    const unavailable = capabilities("unavailable");
    const missingToken = capabilities("available", { hasToken: false });

    for (const state of [unconfigured, checking, unavailable, missingToken]) {
      expect(state.canUpload).toBe(false);
      expect(state.canGenerate).toBe(false);
      expect(state.canPersist).toBe(false);
      expect(state.reason).toBeTruthy();
    }
    expect(unconfigured.availability).toBe("unconfigured");
    expect(unconfigured.recovery).toBe("restart");
    expect(unconfigured.reason).toContain("NEXT_PUBLIC_API_BASE_URL");
    expect(checking.availability).toBe("checking");
    expect(unavailable.availability).toBe("unavailable");
    expect(unavailable.recovery).toBe("retry");
  });

  it("restores every write capability only after a real available state", () => {
    const restored = capabilities("available");

    expect(restored).toMatchObject({
      availability: "available",
      canUpload: true,
      canGenerate: true,
      canPersist: true,
      reason: null,
      recovery: null,
    });
  });

  it("only classifies transport availability errors as global runtime outages", () => {
    expect(isRuntimeConnectionError(new Error(API_CONNECTION_ERROR))).toBe(true);
    expect(isRuntimeConnectionError(new Error("内容校验失败，请修改后重试。"))).toBe(false);
    expect(isRuntimeConnectionError(new Error("AI provider timeout"))).toBe(false);
  });
});

describe("ConversationStart runtime write gate", () => {
  it("blocks chooser, drop, and send before handlers run, then restores in place", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onUploadImages = vi.fn();
    const onRetryConnection = vi.fn();
    const image = new File(["image"], "cover.png", { type: "image/png" });
    const unavailable = capabilities("unavailable");
    const available = capabilities("available");

    const rendered = render(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        onSend={onSend}
        onUploadImages={onUploadImages}
        writeCapabilities={unavailable}
        onRetryWriteAvailability={onRetryConnection}
      />,
    );

    expect(screen.getByText(unavailable.reason!)).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上传 PDF 或文档" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByLabelText("输入对话内容")).toBeDisabled();
    for (const input of rendered.container.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      expect(input).toBeDisabled();
    }

    const startSurface = screen.getAllByLabelText("新建对话")
      .find((element) => element.tagName === "SECTION");
    expect(startSurface).toBeDefined();
    fireEvent.drop(startSurface!, {
      dataTransfer: { files: [image] },
    });
    expect(onUploadImages).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(onRetryConnection).toHaveBeenCalledOnce();

    rendered.rerender(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        onSend={onSend}
        onUploadImages={onUploadImages}
        writeCapabilities={available}
        onRetryWriteAvailability={onRetryConnection}
      />,
    );

    const composer = screen.getByLabelText("输入对话内容");
    expect(composer).toBeEnabled();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeEnabled();
    fireEvent.change(composer, { target: { value: "恢复后继续创作" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
  });
});

describe("ConversationStudio runtime write gate", () => {
  it("blocks upload and optimistic send while unavailable, then restores in place", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const onUploadImages = vi.fn();
    const onPendingExchangeChange = vi.fn();
    const unavailable = capabilities("unavailable");
    const available = capabilities("available");
    const image = new File(["image"], "cover.png", { type: "image/png" });

    const rendered = render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={onSendMessage}
        onUploadImages={onUploadImages}
        onPendingExchangeChange={onPendingExchangeChange}
        writeCapabilities={unavailable}
      />,
    );

    expect(screen.getByText(unavailable.reason!)).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("输入对话内容")).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeDisabled();
    fireEvent.drop(screen.getByLabelText("Content generation conversation"), {
      dataTransfer: { files: [image] },
    });
    expect(onUploadImages).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(onPendingExchangeChange).not.toHaveBeenCalled();
    fireEvent(window, new CustomEvent("multimix:composer-send", {
      detail: { utterance: "绕过输入框发起创作" },
    }));
    expect(onSendMessage).not.toHaveBeenCalled();

    rendered.rerender(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={onSendMessage}
        onUploadImages={onUploadImages}
        onPendingExchangeChange={onPendingExchangeChange}
        writeCapabilities={available}
      />,
    );

    const composer = screen.getByLabelText("输入对话内容");
    fireEvent.change(composer, { target: { value: "恢复后调整文案" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onPendingExchangeChange).toHaveBeenCalled();
  });

  it("hides the standalone generation retry while unavailable and restores it when available", () => {
    const onRetryGeneration = vi.fn();
    const failedJob = generationJob("failed", "standalone-generation-lly-29");
    const rendered = render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        generationJob={failedJob}
        onRetryGeneration={onRetryGeneration}
        writeCapabilities={capabilities("unavailable")}
      />,
    );

    expect(screen.queryByRole("button", { name: "重新执行此步骤" })).not.toBeInTheDocument();

    rendered.rerender(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        generationJob={failedJob}
        onRetryGeneration={onRetryGeneration}
        writeCapabilities={capabilities("available")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新执行此步骤" }));
    expect(onRetryGeneration).toHaveBeenCalledWith(failedJob.id);
  });

  it("hides the message-bound generation retry while unavailable", () => {
    const failedJob = generationJob("failed", "message-generation-lly-29");
    const selectedConversation = {
      ...conversation(),
      messages: [{
        role: "assistant" as const,
        text: "内容生成失败，可以重试。",
        metadata: {
          asset_generation_job_id: failedJob.id,
          asset_generation_status: "failed",
        },
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={selectedConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        generationJob={failedJob}
        onRetryGeneration={vi.fn()}
        writeCapabilities={capabilities("unavailable")}
      />,
    );

    expect(screen.queryByRole("button", { name: "重新执行此步骤" })).not.toBeInTheDocument();
  });

  it("keeps running generation cancellation available while new writes are unavailable", () => {
    const onCancelGeneration = vi.fn();
    const runningJob = generationJob("running", "running-generation-lly-29");

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        generationJob={runningJob}
        onCancelGeneration={onCancelGeneration}
        writeCapabilities={capabilities("unavailable")}
      />,
    );

    const stop = screen.getByRole("button", { name: "停止生成" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onCancelGeneration).toHaveBeenCalledWith(runningJob.id);
  });

  it("hides failed execution retry while unavailable and restores the exact retry when available", () => {
    const onRetryExecution = vi.fn();
    const selectedConversation = {
      ...conversation(),
      messages: [{
        role: "assistant" as const,
        text: "视频生成失败。",
        assetId: 91,
        runSteps: [failedExecutionStep],
      }],
    };
    const liveRunStateByAssetId = {
      91: {
        jobId: "execution-job-lly-29",
        status: "failed",
        steps: [failedExecutionStep],
        errorMessage: "视频生成失败。",
        completionConfirmed: true,
      },
    };
    const rendered = render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={selectedConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        liveRunStateByAssetId={liveRunStateByAssetId}
        onRetryExecution={onRetryExecution}
        writeCapabilities={capabilities("unavailable")}
      />,
    );

    expect(screen.queryByRole("button", { name: "重新执行此步骤" })).not.toBeInTheDocument();

    rendered.rerender(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={selectedConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        liveRunStateByAssetId={liveRunStateByAssetId}
        onRetryExecution={onRetryExecution}
        writeCapabilities={capabilities("available")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新执行此步骤" }));
    expect(onRetryExecution).toHaveBeenCalledWith(
      failedExecutionStep.retryJobId,
      liveRunStateByAssetId[91].jobId,
    );
  });

  it("hides failed Agent action retry while unavailable and restores it when available", () => {
    const onRetryAgentAction = vi.fn();
    const selectedConversation = {
      ...conversation(),
      messages: [{
        role: "assistant" as const,
        text: "视频修改失败。",
        agentAction: failedAgentAction,
        runSteps: [failedExecutionStep],
      }],
    };
    const rendered = render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={selectedConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        liveAgentActionsById={{ [failedAgentAction.id]: failedAgentAction }}
        onRetryAgentAction={onRetryAgentAction}
        writeCapabilities={capabilities("unavailable")}
      />,
    );

    expect(screen.queryByRole("button", { name: "重新执行此步骤" })).not.toBeInTheDocument();

    rendered.rerender(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={selectedConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        liveAgentActionsById={{ [failedAgentAction.id]: failedAgentAction }}
        onRetryAgentAction={onRetryAgentAction}
        writeCapabilities={capabilities("available")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新执行此步骤" }));
    expect(onRetryAgentAction).toHaveBeenCalledWith(failedAgentAction.id);
  });
});

describe("LibraryWorkshop runtime write gate", () => {
  it("keeps browsing available while upload, creation, and persistence are disabled", async () => {
    const row = copyRow();
    const onUploadClick = vi.fn();
    const onUseAsset = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows: [row],
      nextOffset: null,
    });
    const unavailable = capabilities("unavailable");

    render(
      <LibraryWorkshop
        view="copy"
        token="token-library-offline"
        onUploadClick={onUploadClick}
        onUseAsset={onUseAsset}
        writeCapabilities={unavailable}
      />,
    );

    const upload = screen.getByRole("button", { name: "上传" });
    expect(upload).toBeDisabled();
    expect(screen.getByText(unavailable.reason!)).toHaveAttribute("role", "status");

    const grid = await screen.findByLabelText("文案库列表");
    fireEvent.click(within(grid).getByText(row.title).closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: `${row.title}详情` });
    expect(within(dialog).getByRole("button", { name: "复制" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "用于创作" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "生成视频" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "删除" })).toBeDisabled();

    fireEvent.click(upload);
    fireEvent.click(within(dialog).getByRole("button", { name: "用于创作" }));
    expect(onUploadClick).not.toHaveBeenCalled();
    expect(onUseAsset).not.toHaveBeenCalled();
  });
});

describe("AssetsWorkspaceClient runtime availability integration", () => {
  it("keeps writes disabled while the first real backend check is pending", async () => {
    let resolveSummaries!: (value: []) => void;
    const pendingSummaries = new Promise<[]>((resolve) => {
      resolveSummaries = resolve;
    });
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockReturnValue(pendingSummaries);

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="checking@multimix.local"
        token="checking-token"
      />,
    );

    expect(screen.getByText("正在连接后端，短视频创作、素材上传和保存暂不可用。")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    resolveSummaries([]);
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
  });

  it("renders an unconfigured workspace with upload and send disabled before interaction", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(false);
    const loadSummaries = vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries");
    const uploadAsset = vi.spyOn(assetWorkspaceAdapter, "uploadAsset");

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="offline@multimix.local"
        token="offline-token"
      />,
    );

    expect(
      (await screen.findAllByText(/请配置 NEXT_PUBLIC_API_BASE_URL 后重启前端/)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    const startSurface = screen.getAllByLabelText("新建对话")
      .find((element) => element.tagName === "SECTION");
    expect(startSurface).toBeDefined();
    fireEvent.drop(startSurface!, {
      dataTransfer: { files: [new File(["image"], "offline.png", { type: "image/png" })] },
    });
    expect(uploadAsset).not.toHaveBeenCalled();
    expect(loadSummaries).not.toHaveBeenCalled();
  });

  it("keeps cached summaries browsable but read-only during a connection outage", async () => {
    const accountEmail = "cached@multimix.local";
    writeConversationSummaryCache(window.localStorage, accountEmail, [{
      id: "cached-conversation",
      title: "缓存中的真实对话",
      status: "ready",
      metadata: {},
      created_at: "2026-08-24T08:00:00Z",
      updated_at: "2026-08-25T08:00:00Z",
    }]);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries")
      .mockRejectedValue(new Error(API_CONNECTION_ERROR));

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail={accountEmail}
        token="cached-token"
      />,
    );

    expect(await screen.findByText("缓存中的真实对话")).toBeInTheDocument();
    expect(await screen.findByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("recovers write controls after the existing real reload succeeds", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const loadSummaries = vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries")
      .mockRejectedValueOnce(new Error(API_CONNECTION_ERROR))
      .mockResolvedValueOnce([]);

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="recover@multimix.local"
        token="recover-token"
      />,
    );

    expect(await screen.findByText("对话加载失败")).toBeInTheDocument();
    expect(await screen.findByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    await waitFor(() => expect(loadSummaries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
    expect(screen.queryByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).not.toBeInTheDocument();
  });

  it("closes subsequent write entry points after a live send connection failure", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([]);
    const sendMessage = vi.spyOn(assetWorkspaceAdapter, "sendMessage")
      .mockRejectedValue(new Error(API_CONNECTION_ERROR));

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="send-outage@multimix.local"
        token="send-outage-token"
      />,
    );

    const composer = screen.getByLabelText("输入对话内容");
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: "生成一条离线测试文案" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(await screen.findByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("does not globally downgrade write capabilities for a non-connection business error", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([]);
    const sendMessage = vi.spyOn(assetWorkspaceAdapter, "sendMessage")
      .mockRejectedValue(new Error("内容校验失败，请修改后重试。"));

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="business-error@multimix.local"
        token="business-error-token"
      />,
    );

    const composer = screen.getByLabelText("输入对话内容");
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: "生成一条待校验文案" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
    expect(screen.queryByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).not.toBeInTheDocument();
  });

  it("keeps running cancellation callable and marks a cancel connection failure unavailable", async () => {
    const conversationId = "running-cancel-conversation";
    const runningJob = generationJob("running", "cancel-connection-job");
    const runningConversation = {
      ...conversation(),
      id: conversationId,
      title: "运行中的生成任务",
      messages: [{
        role: "assistant" as const,
        text: "内容正在生成。",
        metadata: {
          asset_generation_job_id: runningJob.id,
          asset_generation_status: "running",
          asset_generation_started_at: runningJob.started_at,
        },
      }],
    };
    window.history.replaceState(null, "", `/app/assets?conversation=${conversationId}`);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([{
      id: conversationId,
      title: runningConversation.title,
      status: "running",
      metadata: {},
      created_at: "2026-08-25T08:00:00Z",
      updated_at: "2026-08-25T08:00:05Z",
    }]);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSnapshot").mockResolvedValue({
      ...runningConversation,
      detailsLoaded: false,
    });
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue(runningConversation);
    const getGenerationJob = vi.spyOn(assetWorkspaceAdapter, "getGenerationJob")
      .mockResolvedValue(runningJob);
    const cancelGenerationJob = vi.spyOn(assetWorkspaceAdapter, "cancelGenerationJob")
      .mockRejectedValue(new Error(API_CONNECTION_ERROR));

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="cancel-outage@multimix.local"
        token="cancel-outage-token"
        initialConversationId={conversationId}
      />,
    );

    const stop = await screen.findByRole("button", { name: "停止生成" });
    expect(stop).toBeEnabled();
    await waitFor(() => expect(getGenerationJob).toHaveBeenCalled());
    fireEvent.click(stop);

    await waitFor(() => expect(cancelGenerationJob).toHaveBeenCalledWith(
      "cancel-outage-token",
      runningJob.id,
    ));
    expect(await screen.findByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).toBeInTheDocument();
  });
});
