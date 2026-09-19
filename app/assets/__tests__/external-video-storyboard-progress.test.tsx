// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storyboardClient = vi.hoisted(() => ({
  getVideoStoryboardJob: vi.fn(),
  retryVideoStoryboardJob: vi.fn(),
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
  });

  it.each([
    ["queued", "queued", "正在准备识别分镜…"],
    ["running", "reading_source", "正在读取视频…"],
    ["running", "analyzing", "正在识别并拆分分镜…"],
  ])("restores %s/%s progress from the persisted job", async (status, stage, label) => {
    storyboardClient.getVideoStoryboardJob.mockResolvedValue(job({ status, stage }));
    const { unmount } = render(
      <ExternalVideoStoryboardProgress token="token" sourceAssetId={7} jobId="storyboard-job-1" />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(label);
    expect(storyboardClient.getVideoStoryboardJob).toHaveBeenCalledWith("token", 7, "storyboard-job-1");
    unmount();
  });

  it("shows the recognized scene count when the job completes", async () => {
    storyboardClient.getVideoStoryboardJob.mockResolvedValue(job({
      status: "completed",
      stage: "done",
      storyboard: { scene_count: 6, scenes: [] },
    }));
    render(<ExternalVideoStoryboardProgress token="token" sourceAssetId={7} jobId="storyboard-job-1" />);

    expect(await screen.findByRole("status")).toHaveTextContent("已识别 6 个分镜");
    expect(screen.getByText("现在可以直接说“把第 2 镜改成动画”。")).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "重试分镜识别" }));

    await waitFor(() => expect(storyboardClient.retryVideoStoryboardJob).toHaveBeenCalledWith(
      "token", 7, "storyboard-job-1",
    ));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("正在准备识别分镜…"));
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

    expect(await screen.findByLabelText("分镜识别进度")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已识别 4 个分镜");
  });
});
