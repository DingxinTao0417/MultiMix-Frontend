// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_CONNECTION_ERROR, type AssetGenerationJobResponse } from "../../../lib/api";
import * as api from "../../../lib/api";
import AssetsWorkspaceClient from "../components/assets-workspace-client";
import ConversationStart from "../components/conversation-start";
import ConversationStudio from "../components/conversation-studio";
import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import type { AgentActionRunResponse, AgentRunStep } from "../lib/asset-workspace-types";
import { writeConversationSummaryCache } from "../lib/conversation-summary-cache";
import { displayProducts } from "./fixtures/display-products";
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

function keyframeConversation(id = "keyframe-conversation") {
  const product = {
    ...assetWorkspaceAdapter.getNewConversation().product,
    id: "asset-91",
    backendAssetId: 91,
    contentType: "storyboard_image",
    mode: "image" as const,
    title: "F01 · 开场产品特写",
    metadata: {
      generated_images: [1, 2, 3].map((index) => ({
        frame_id: `F0${index}`,
        asset_id: 200 + index,
        target_scene_id: `scene-${index}`,
        intent: `分镜 ${index}`,
        review_status: "no_issue_detected",
        storage_ref: `local://content-assets/91/generation-jobs/1/images/${String(index).repeat(64)}.png`,
      })),
      image_generation_candidate_set_hash: "a".repeat(64),
      image_generation_target: {
        kind: "director_scene",
        asset_id: 91,
        version_id: 7,
        scene_ids: ["scene-1", "scene-2", "scene-3"],
      },
    },
  };
  return {
    ...conversation(),
    id,
    title: "三张连续关键帧",
    product,
    products: [product],
    messages: [{
      role: "assistant" as const,
      text: "已生成 3 张连续关键帧。",
      assetId: 91,
    }],
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
    expect(unconfigured.reason).toBe("创作服务尚未连接，请联系管理员完成配置后重试。");
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
    const failedJob = {
      ...generationJob("failed", "standalone-generation-lly-29"),
      retryable: true,
    };
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
  it.each([
    { conversationId: "ordinary-upload-project", understandingStatus: "ready", shouldAdd: true },
    { conversationId: "ordinary-upload-project", understandingStatus: "failed", shouldAdd: false },
    { conversationId: "new", understandingStatus: "ready", shouldAdd: false },
  ] as const)("routes an ordinary upload in $conversationId with understanding=$understandingStatus", async ({ conversationId, understandingStatus, shouldAdd }) => {
    const detail = { ...conversation(), id: conversationId, title: "早餐项目" };
    window.history.replaceState(null, "", `/app/assets?conversation=${conversationId}`);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:ordinary-upload") });
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue(
      conversationId === "new" ? [] : [{
        id: conversationId, title: detail.title, status: "ready", metadata: {},
        created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
      }],
    );
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue(detail);
    const addSource = vi.spyOn(api, "addProjectSource").mockResolvedValue({} as Awaited<ReturnType<typeof api.addProjectSource>>);
    const uploadAsset = vi.spyOn(assetWorkspaceAdapter, "uploadAsset").mockResolvedValue({
      id: 142, title: "用户早餐图.png", status: "ready",
      metadata: { understanding: { status: understandingStatus } },
    } as unknown as Awaited<ReturnType<typeof assetWorkspaceAdapter.uploadAsset>>);
    vi.spyOn(assetWorkspaceAdapter, "getLatestAssetIngestJob").mockResolvedValue({
      status: "completed", understanding_status: understandingStatus,
      understanding_failure_category: understandingStatus === "failed" ? "provider_timeout" : null,
    } as Awaited<ReturnType<typeof assetWorkspaceAdapter.getLatestAssetIngestJob>>);
    const sendMessage = vi.spyOn(assetWorkspaceAdapter, "sendMessage");

    render(<AssetsWorkspaceClient basePath="/app/assets" accountEmail="ordinary@multimix.local"
      token="ordinary-token" initialConversationId={conversationId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "上传图片素材" })).toBeEnabled());
    const uploadButton = screen.getByRole("button", { name: "上传图片素材" });
    const fileInput = uploadButton.previousElementSibling as HTMLInputElement;
    expect(fileInput.type).toBe("file");
    fireEvent.change(fileInput, { target: { files: [new File(["image"], "用户早餐图.png", { type: "image/png" })] } });
    await waitFor(() => expect(uploadAsset).toHaveBeenCalled());

    if (shouldAdd) {
      await waitFor(() => expect(addSource).toHaveBeenCalledWith("ordinary-token", conversationId, 142));
      expect(screen.getAllByText(/用户早餐图.png/).length).toBeGreaterThan(0);
    } else {
      await waitFor(() => expect(screen.getAllByText(understandingStatus === "failed"
        ? /素材理解失败|视觉服务响应超时/ : /用户早餐图.png/).length).toBeGreaterThan(0));
      expect(addSource).not.toHaveBeenCalled();
    }
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "为分镜选择项目图片" })).not.toBeInTheDocument();
  });

  it.each([
    { uploadStatus: "ready", versionChanged: false, understandingStatus: "ready" },
    { uploadStatus: "processing", versionChanged: false, understandingStatus: "ready" },
    { uploadStatus: "ready", versionChanged: true, understandingStatus: "ready" },
    { uploadStatus: "ready", versionChanged: false, understandingStatus: "failed" },
    { uploadStatus: "processing", versionChanged: false, understandingStatus: "failed" },
  ] as const)("handles a $uploadStatus scene upload with understanding=$understandingStatus when versionChanged=$versionChanged", async ({ uploadStatus, versionChanged, understandingStatus }) => {
    const conversationId = "scene-upload-conversation";
    const product = {
      ...displayProducts["case-01-director-draft"],
      id: "scene-upload-director", backendAssetId: 91,
      mode: "copy" as const, contentType: "video_script",
      versions: [{ id: "7", label: "第 7 版", savedAt: "刚刚", status: "已保存" }],
      metadata: { video_plan: { scenes: [{ id: "scene-2", title: "早餐主体", visual_brief: "蒸笼里的早餐" }] } },
    };
    const detail = {
      ...conversation(), id: conversationId, title: "早餐视频",
      product, products: [product],
    };
    const changedProduct = { ...product, versions: [{
      id: "8", label: "第 8 版", savedAt: "刚刚", status: "已保存",
    }] };
    const changedDetail = { ...detail, product: changedProduct, products: [changedProduct] };
    window.history.replaceState(null, "", `/app/assets?conversation=${conversationId}`);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:scene-upload") });
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([{
      id: conversationId, title: detail.title, status: "ready", metadata: {},
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    }]);
    const addSource = vi.spyOn(api, "addProjectSource").mockResolvedValue({} as Awaited<ReturnType<typeof api.addProjectSource>>);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockImplementation(async () =>
      versionChanged && addSource.mock.calls.length ? changedDetail : detail);
    vi.spyOn(assetWorkspaceAdapter, "uploadAsset").mockResolvedValue({
      id: 42, title: "早餐.png", status: uploadStatus,
      metadata: { understanding: { status: understandingStatus } },
    } as unknown as Awaited<ReturnType<typeof assetWorkspaceAdapter.uploadAsset>>);
    vi.spyOn(assetWorkspaceAdapter, "getLatestAssetIngestJob").mockResolvedValue({
      status: "completed", understanding_status: understandingStatus,
      understanding_failure_category: understandingStatus === "failed"
        ? uploadStatus === "ready" ? "provider_billing" : "provider_timeout" : null,
    } as Awaited<ReturnType<typeof assetWorkspaceAdapter.getLatestAssetIngestJob>>);
    const reparse = vi.spyOn(assetWorkspaceAdapter, "reparseAsset").mockResolvedValue({
      id: 42, title: "早餐.png", status: "ready",
      metadata: { understanding: { status: "ready" } },
    } as unknown as Awaited<ReturnType<typeof assetWorkspaceAdapter.reparseAsset>>);
    const sendMessage = vi.spyOn(assetWorkspaceAdapter, "sendMessage").mockResolvedValue({
      conversationId, conversation: detail, product, generationJob: null, agentAction: null,
    });
    const reviewFit = vi.spyOn(assetWorkspaceAdapter, "reviewSceneImageFit").mockResolvedValue({
      status: uploadStatus === "processing" ? "mismatch" : "partial",
      source_asset_id: 42, director_version_id: 7,
      scene_id: "scene-2", evidence: "早餐主体可见，但热气不明显",
      matched_required_elements: ["早餐主体"], missing_required_elements: ["热气"],
      excluded_elements_present: [], technical_quality: { publishable: true, reason: "画面清晰" },
      error_code: "",
    });

    render(<AssetsWorkspaceClient basePath="/app/assets" accountEmail="scene@multimix.local"
      token="scene-token" initialConversationId={conversationId} />);
    fireEvent.click(await screen.findByText("查看逐镜来源与分镜详情"));
    fireEvent.click(within(screen.getByRole("listitem", { name: "早餐主体" }))
      .getByRole("button", { name: "上传素材" }));
    const file = new File(["image"], "早餐.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传图片用于指定分镜"), { target: { files: [file] } });

    if (understandingStatus === "failed") {
      await waitFor(() => expect(screen.getAllByText(uploadStatus === "ready"
        ? /视觉服务账户或计费不可用/ : /视觉服务响应超时/).length).toBeGreaterThan(0));
      expect(addSource).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "为分镜选择项目图片" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      await waitFor(() => expect(reparse).toHaveBeenCalledWith("scene-token", 42));
      await waitFor(() => expect(addSource).toHaveBeenCalledWith("scene-token", conversationId, 42));
      expect(await screen.findByRole("dialog", { name: "为分镜选择项目图片" })).toBeInTheDocument();
      return;
    }

    await waitFor(() => expect(addSource).toHaveBeenCalledWith("scene-token", conversationId, 42));
    expect(addSource).toHaveBeenCalledTimes(1);
    if (versionChanged) {
      await waitFor(() => expect(screen.getByText(/图片已保存到项目，但编导稿版本已变化/)).toBeInTheDocument());
      expect(screen.queryByRole("dialog", { name: "为分镜选择项目图片" })).not.toBeInTheDocument();
      expect(sendMessage).not.toHaveBeenCalled();
      return;
    }
    const picker = await screen.findByRole("dialog", { name: "为分镜选择项目图片" });
    expect(within(picker).getByText("上传图片 #42")).toBeInTheDocument();
    expect(within(picker).getByText(/先选一张查看它与本镜目标的适配建议/)).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "暂不用于本镜，留在项目" })).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "先修改本镜画面" })).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    if (uploadStatus === "ready") {
      fireEvent.click(within(picker).getByRole("button", { name: "暂不用于本镜，留在项目" }));
      expect(screen.queryByRole("dialog", { name: "为分镜选择项目图片" })).not.toBeInTheDocument();
      expect(sendMessage).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(within(picker).getByRole("button", { name: /早餐.png/ }));
    await waitFor(() => expect(reviewFit).toHaveBeenCalledWith("scene-token", 42, {
      conversation_id: conversationId, director_asset_id: 91,
      director_version_id: 7, scene_id: "scene-2",
    }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await within(picker).findByText(/早餐主体可见，但热气不明显/)).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: uploadStatus === "processing"
      ? "仍用于本镜（画面目标可能不符）" : "确认用于本镜" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sceneSourceDecision: expect.objectContaining({
        directorAssetId: 91, directorVersionId: 7,
        sceneId: "scene-2", action: "use_saved_asset", sourceAssetId: 42,
      }),
    })));
  });

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
      (await screen.findAllByText(/请联系管理员完成配置后重试/)).length,
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
      project_state: { code: "ready" },
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

    expect(await screen.findByText("项目加载失败")).toBeInTheDocument();
    expect(await screen.findByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    await waitFor(() => expect(loadSummaries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
    expect(screen.queryByText(/后端暂时不可用，短视频创作、素材上传和保存暂不可用/)).not.toBeInTheDocument();
  });

  it("keeps an existing keyframe-set application reachable while full detail hydrates", async () => {
    const conversationId = "keyframe-conversation";
    const snapshot = { ...keyframeConversation(conversationId), detailsLoaded: false };
    const detail = { ...keyframeConversation(conversationId), detailsLoaded: true };
    let resolveDetail!: (value: typeof detail) => void;
    const pendingDetail = new Promise<typeof detail>((resolve) => {
      resolveDetail = resolve;
    });
    window.history.replaceState(null, "", `/app/assets?conversation=${conversationId}`);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([{
      id: conversationId,
      title: snapshot.title,
      status: "ready",
      metadata: {},
      created_at: "2026-09-07T11:00:00Z",
      updated_at: "2026-09-07T11:00:00Z",
    }]);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationSnapshot").mockResolvedValue(snapshot);
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockReturnValue(pendingDetail);
    const sendMessage = vi.spyOn(assetWorkspaceAdapter, "sendMessage").mockResolvedValue({
      conversationId,
      conversation: detail,
      product: detail.product,
      generationJob: null,
      agentAction: null,
    });

    render(
      <AssetsWorkspaceClient
        basePath="/app/assets"
        accountEmail="keyframes@multimix.local"
        token="keyframes-token"
        initialConversationId={conversationId}
      />,
    );

    await screen.findAllByText("F01 · 开场产品特写", {}, { timeout: 5_000 });
    const applyKeyframes = await screen.findByRole("button", { name: "将 3 张分别用于 3 个分镜" });
    expect(applyKeyframes).toBeEnabled();
    fireEvent.click(applyKeyframes);
    expect(sendMessage).not.toHaveBeenCalled();

    resolveDetail(detail);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      imageGenerationSetApplication: expect.objectContaining({
        expectedCandidateSetHash: "a".repeat(64),
        target: expect.objectContaining({ assetId: 91, versionId: 7 }),
      }),
    })));
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
