// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storyboardClient = vi.hoisted(() => ({
  getVideoStoryboardJob: vi.fn(),
  retryVideoStoryboardJob: vi.fn(),
  confirmVideoStoryboard: vi.fn(),
}));

vi.mock("../lib/video-storyboard-client", async () => {
  const actual = await vi.importActual<typeof import("../lib/video-storyboard-client")>(
    "../lib/video-storyboard-client",
  );
  return { ...actual, ...storyboardClient };
});

import ExternalVideoStoryboardProgress from "../components/external-video-storyboard-progress";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "storyboard-job-1",
    status: "running",
    stage: "reading_source",
    retryable: false,
    message: null,
    error_code: null,
    storyboard: null,
    follow_up_status: null,
    animation_job_id: null,
    animation_job_status: null,
    ...overrides,
  };
}

describe("ExternalVideoStoryboardProgress", () => {
  beforeEach(() => {
    storyboardClient.getVideoStoryboardJob.mockReset();
    storyboardClient.retryVideoStoryboardJob.mockReset();
    storyboardClient.confirmVideoStoryboard.mockReset();
  });

  it.each([
    ["queued", "queued", "正在准备整理视频…"],
    ["running", "reading_source", "正在读取视频…"],
    ["running", "analyzing", "正在查看画面变化…"],
  ])("restores %s/%s progress from the persisted job", async (status, stage, label) => {
    storyboardClient.getVideoStoryboardJob.mockResolvedValue(job({ status, stage }));
    const { unmount } = render(
      <ExternalVideoStoryboardProgress token="token" sourceAssetId={7} jobId="storyboard-job-1" />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(label);
    expect(storyboardClient.getVideoStoryboardJob).toHaveBeenCalledWith("token", 7, "storyboard-job-1");
    unmount();
  });

  it("keeps completion guidance outside the progress card without prescribing a specific edit", async () => {
    storyboardClient.getVideoStoryboardJob.mockResolvedValue(job({
      status: "completed",
      stage: "done",
      storyboard: { scene_count: 6, scenes: [] },
    }));
    render(<ExternalVideoStoryboardProgress token="token" sourceAssetId={7} jobId="storyboard-job-1" />);

    const progress = await screen.findByLabelText("视频整理进度");
    expect(screen.getByRole("status")).toHaveTextContent("已整理为 6 个片段");
    expect(progress).not.toHaveTextContent("接下来，告诉我想调整哪一部分就可以");
    expect(screen.getByText("视频已经整理好了，共 6 个片段。接下来，告诉我想调整哪一部分就可以。"))
      .toBeInTheDocument();
    expect(screen.queryByText(/第 2 镜改成动画/)).not.toBeInTheDocument();
  });

  it("offers same-job retry only for a retryable failure", async () => {
    storyboardClient.getVideoStoryboardJob
      .mockResolvedValueOnce(job({
        status: "failed",
        stage: "failed",
        retryable: true,
        message: "素材读取失败，可以从同一任务重试。",
      }))
      .mockResolvedValue(job({ status: "queued", stage: "queued" }));
    storyboardClient.retryVideoStoryboardJob.mockResolvedValue(job({ status: "queued", stage: "queued" }));
    render(<ExternalVideoStoryboardProgress token="token" sourceAssetId={7} jobId="storyboard-job-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "重新整理视频" }));

    await waitFor(() => expect(storyboardClient.retryVideoStoryboardJob).toHaveBeenCalledWith(
      "token", 7, "storyboard-job-1",
    ));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("正在准备整理视频…"));
  });

  it("restores the progress card from persisted assistant intent after conversation reload", async () => {
    storyboardClient.getVideoStoryboardJob.mockResolvedValue(job({
      status: "completed",
      stage: "done",
      storyboard: { scene_count: 4, scenes: [] },
    }));
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-1",
      detailsLoaded: true,
      readonly: false,
      messages: [{
        role: "assistant" as const,
        text: "已开始识别并拆分视频分镜。",
        metadata: {
          intent: {
            capability: "external_video_storyboard",
            operation: "analyze_storyboard",
            source_asset_id: 7,
            job_id: "storyboard-job-1",
          },
        },
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        readonly={false}
        requirementAnalyticsToken="token"
      />,
    );

    expect(await screen.findByLabelText("视频整理进度")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已整理为 4 个片段");
    expect(screen.getByText("好的，我先看看视频内容，并整理成几个片段。完成后会在这里告诉你。"))
      .toBeInTheDocument();
    expect(screen.queryByText("已开始识别并拆分视频分镜。")).not.toBeInTheDocument();
  });

  it("presents a video-only upload as a natural conversation without exposing internal instructions", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-2",
      detailsLoaded: true,
      readonly: false,
      messages: [
        {
          role: "user" as const,
          text: "我上传了一条视频，请先询问我是否识别并拆分分镜，暂不开始处理。",
        },
        {
          role: "assistant" as const,
          text: "要先识别并拆分这条视频的分镜吗？识别后可以按第 1 镜、第 2 镜逐段修改。",
          metadata: {
            intent: {
              capability: "external_video_storyboard",
              operation: "offer_storyboard",
              source_asset_id: 7,
            },
          },
          suggestionActions: [
            {
              id: "external-video-storyboard-confirm",
              label: "识别并拆分分镜",
              utterance: "识别并拆分分镜",
              actionType: "submit_message" as const,
              enabled: true,
              requiresConfirmation: false,
            },
            {
              id: "external-video-storyboard-decline",
              label: "暂不识别",
              utterance: "暂不识别",
              actionType: "submit_message" as const,
              enabled: true,
              requiresConfirmation: false,
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
        onSendMessage={onSendMessage}
        readonly={false}
      />,
    );

    expect(screen.getByText("我上传了一条视频。")).toBeInTheDocument();
    expect(screen.getByText("视频已上传。要先帮你把它整理成几个片段吗？整理后，你可以更方便地告诉我想调整哪一部分。"))
      .toBeInTheDocument();
    expect(screen.queryByText(/请先询问我是否/)).not.toBeInTheDocument();
    expect(screen.queryByText(/第 1 镜、第 2 镜/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帮我整理视频" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "先不用" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "帮我整理视频" }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onSendMessage.mock.calls[0]?.[1]).toBe("识别并拆分分镜");
  });

  it("confirms the proposed segments and resumes the user's pending edit with one clear action", async () => {
    storyboardClient.confirmVideoStoryboard.mockResolvedValue({
      status: "ready",
      source_asset_id: 7,
      storyboard_fingerprint: "sha256:confirmed",
      scene_count: 6,
      scenes: [],
    });
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "conversation-3",
      detailsLoaded: true,
      readonly: false,
      messages: [
        { role: "user" as const, text: "把第 2 个片段改成动画" },
        {
          role: "assistant" as const,
          text: "我已经自动拆分出 6 个分镜。当前边界需要确认，确认后再执行动画生成，避免改错片段。",
          metadata: {
            intent: {
              capability: "external_video_animation",
              operation: "confirm_storyboard",
              source_asset_id: 7,
              scene_ordinal: 2,
              storyboard_fingerprint: "sha256:proposed",
            },
          },
        },
      ],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={onSendMessage}
        readonly={false}
        requirementAnalyticsToken="token"
      />,
    );

    expect(screen.getByText("片段已经整理出来了。确认后，我会继续刚才的修改。"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认片段并继续" }));

    await waitFor(() => expect(storyboardClient.confirmVideoStoryboard).toHaveBeenCalledWith(
      "token", 7, "sha256:proposed",
    ));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onSendMessage.mock.calls[0]?.[1]).toBe("把第 2 个片段改成动画");
  });
});
