// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const row: LibraryRow = {
  assetId: 71,
  title: "门店实拍视频",
  meta: "视频素材 · 已理解",
  note: "门店空间与产品展示",
  kind: "video",
  category: "实景拍摄视频",
  contentType: "视频",
  contentTypeCode: "uploaded_video",
  statusLabel: "已理解",
  updatedLabel: "刚刚",
  previewUrl: "https://cdn.example/store.mp4",
};

async function openVideoDetails() {
  const grid = await screen.findByLabelText("视频库列表");
  fireEvent.click(within(grid).getByRole("button"));
  return screen.findByRole("dialog", { name: "门店实拍视频详情" });
}

async function openVideoDetailsFor(videoRow: LibraryRow, token: string) {
  vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
  vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [videoRow], nextOffset: null });
  render(<LibraryWorkshop view="video" token={token} />);
  const grid = await screen.findByLabelText("视频库列表");
  fireEvent.click(within(grid).getByRole("button"));
  return screen.findByRole("dialog", { name: `${videoRow.title}详情` });
}

describe("video library creation actions", () => {
  it("starts video creation from the generic creation action", async () => {
    const onUseAsset = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [row], nextOffset: null });

    render(<LibraryWorkshop view="video" token="token" onUseAsset={onUseAsset} />);

    const dialog = await openVideoDetails();
    expect(within(dialog).getByLabelText("门店实拍视频视频预览")).toHaveAttribute("src", row.previewUrl);
    fireEvent.click(within(dialog).getByRole("button", { name: "用于创作" }));

    expect(onUseAsset).toHaveBeenCalledWith(row, "video");
  });

  it("can start adding a saved video to a project", async () => {
    const onAddAssetToConversation = vi.fn();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [row], nextOffset: null });

    render(
      <LibraryWorkshop
        view="video"
        token="token"
        onAddAssetToConversation={onAddAssetToConversation}
      />,
    );

    const dialog = await openVideoDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "加入项目…" }));

    expect(onAddAssetToConversation).toHaveBeenCalledWith(row);
  });

  it("explains a failed project instead of showing a disabled black player", async () => {
    const failedProject: LibraryRow = {
      ...row,
      title: "失败的视频工程",
      contentTypeCode: "video_project",
      previewUrl: undefined,
      productStatus: "failed",
      statusLabel: "失败",
      failureReason: "第 1 镜素材不可用，请调整素材后再继续。",
    };

    const dialog = await openVideoDetailsFor(failedProject, "token-failed-project");

    expect(within(dialog).getByRole("status", { name: "视频预览状态" })).toHaveClass("failed");
    expect(within(dialog).getByText("视频生成失败")).toBeInTheDocument();
    expect(within(dialog).getByText(failedProject.failureReason!)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "播放视频预览" })).not.toBeInTheDocument();
  });

  it("explains that a completed project is editable before it has an MP4", async () => {
    const editableProject: LibraryRow = {
      ...row,
      title: "已完成的视频工程",
      contentTypeCode: "video_project",
      previewUrl: undefined,
      productStatus: "completed",
      statusLabel: "完成",
    };

    const dialog = await openVideoDetailsFor(editableProject, "token-editable-project");

    expect(within(dialog).getByRole("status", { name: "视频预览状态" })).toHaveClass("ready");
    expect(within(dialog).getByText("视频工程已准备好")).toBeInTheDocument();
    expect(within(dialog).getByText("当前还没有可播放的成片，可打开剪辑器继续编辑并导出。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "打开剪辑器" })).toBeEnabled();
  });

  it("distinguishes an unavailable uploaded file from a generated project", async () => {
    const missingUpload: LibraryRow = {
      ...row,
      title: "原文件缺失的视频",
      previewUrl: undefined,
      mediaAvailability: "missing",
      statusLabel: "原文件不可用",
    };

    const dialog = await openVideoDetailsFor(missingUpload, "token-missing-upload");

    expect(within(dialog).getByRole("status", { name: "视频预览状态" })).toHaveClass("missing");
    expect(within(dialog).getByText("原视频暂不可用")).toBeInTheDocument();
    expect(within(dialog).getByText("当前文件无法读取，请重新上传或检查素材来源后再继续。")).toBeInTheDocument();
  });

  it("analyzes an uploaded video only on request, previews numbered scenes, and confirms uncertain boundaries", async () => {
    const storyboard = {
      schema_version: "external_video_storyboard_v1",
      status: "needs_review",
      source_asset_id: 71,
      storyboard_fingerprint: "sha256:proposed",
      duration_seconds: 10,
      scene_count: 2,
      scenes: [
        { scene_id: "scene_001", ordinal: 1, start_seconds: 0, end_seconds: 5, duration_seconds: 5, title: "开场", description: "门店展示", confidence: 0.9, status: "ready", preview_url: "/v1/assets/files/1" },
        { scene_id: "scene_002", ordinal: 2, start_seconds: 5, end_seconds: 10, duration_seconds: 5, title: "产品", description: "产品特写", confidence: 0.7, status: "needs_review", preview_url: "/v1/assets/files/1" },
      ],
    };
    const storyboardJob = {
      job_id: "storyboard-job-1",
      status: "completed",
      stage: "done",
      retryable: false,
      message: null,
      error_code: null,
      storyboard,
      follow_up_status: null,
      animation_job_id: null,
      animation_job_status: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method) {
        if (url.endsWith("/storyboard/jobs/latest")) {
          return new Response(JSON.stringify({ detail: "job unavailable" }), { status: 404 });
        }
        if (url.endsWith("/storyboard/jobs/storyboard-job-1")) {
          return new Response(JSON.stringify(storyboardJob), { status: 200 });
        }
        return new Response(JSON.stringify({ detail: "storyboard unavailable" }), { status: 409 });
      }
      if (url.endsWith("/animate")) {
        const payload = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ job_id: "animation-job-1", status: "completed", scene_id: "scene_002", style: payload.style, result_asset_id: 72, error_code: null, message: null, generation: payload.style === "generative_animation_v1" ? { estimated_standard_cost_cny: 2.25, billed_seconds: 15 } : null }), { status: 200 });
      }
      if (url.endsWith("/confirm")) {
        return new Response(JSON.stringify({ ...storyboard, status: "ready", storyboard_fingerprint: "sha256:confirmed", scenes: storyboard.scenes.map((scene) => ({ ...scene, status: "ready" })) }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ...storyboardJob,
        status: "queued",
        stage: "queued",
        storyboard: null,
      }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const dialog = await openVideoDetailsFor(row, "token-storyboard");
    expect(within(dialog).queryByText("02 · 产品")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "识别这条视频的分镜" }));
    expect(await within(dialog).findByText("02 · 产品")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "预览第 2 个分镜" }));
    expect((within(dialog).getByLabelText("门店实拍视频视频预览") as HTMLVideoElement).currentTime).toBe(5);
    fireEvent.click(within(dialog).getByRole("button", { name: "确认这些分镜边界" }));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "确认这些分镜边界" })).not.toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "为第 2 镜生成 AI 动画" }));
    expect(await within(dialog).findByText("AI 动画已保存到视频库，视频生成预计 ¥2.25，关键帧费用按图片模型账单计。")).toBeInTheDocument();
    const animationRequest = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/animate"));
    expect(JSON.parse(String(animationRequest?.[1]?.body))).toMatchObject({
      scene_ordinal: 2,
      style: "generative_animation_v1",
    });
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).endsWith("/storyboard") && init?.method === "POST"
    ))).toHaveLength(1);
  });

  it("recovers the latest animation result after the video details remount", async () => {
    const storyboard = {
      schema_version: "external_video_storyboard_v1",
      status: "ready",
      source_asset_id: 71,
      storyboard_fingerprint: "sha256:ready",
      duration_seconds: 10,
      scene_count: 2,
      scenes: [
        { scene_id: "scene_001", ordinal: 1, start_seconds: 0, end_seconds: 5, duration_seconds: 5, title: "开场", description: "门店展示", confidence: 0.9, status: "ready", preview_url: "/v1/assets/files/1" },
        { scene_id: "scene_002", ordinal: 2, start_seconds: 5, end_seconds: 10, duration_seconds: 5, title: "产品", description: "产品特写", confidence: 0.9, status: "ready", preview_url: "/v1/assets/files/1" },
      ],
    };
    const latestJob = {
      job_id: "animation-job-existing",
      status: "completed",
      scene_id: "scene_002",
      style: "generative_animation_v1",
      result_asset_id: 72,
      generation: { estimated_standard_cost_cny: 2.25, billed_seconds: 15 },
      error_code: null,
      message: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input).endsWith("/animate/latest") ? latestJob : storyboard),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    let dialog = await openVideoDetailsFor(row, "token-storyboard");
    expect(await within(dialog).findByText("AI 动画已保存到视频库，视频生成预计 ¥2.25，关键帧费用按图片模型账单计。")).toBeInTheDocument();
    cleanup();

    dialog = await openVideoDetailsFor(row, "token-storyboard");
    expect(await within(dialog).findByText("AI 动画已保存到视频库，视频生成预计 ¥2.25，关键帧费用按图片模型账单计。")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/animate/latest"))).toHaveLength(2);
  });

  it("restores the same running storyboard job after opening the video again", async () => {
    const runningJob = {
      job_id: "storyboard-job-running",
      status: "running",
      stage: "reading_source",
      retryable: false,
      message: null,
      error_code: null,
      storyboard: null,
      follow_up_status: null,
      animation_job_id: null,
      animation_job_status: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      if (url.endsWith("/storyboard")) {
        return new Response(JSON.stringify({ detail: "storyboard unavailable" }), { status: 409 });
      }
      return new Response(JSON.stringify(runningJob), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const dialog = await openVideoDetailsFor(row, "token-running-storyboard");
    expect(await within(dialog).findByText("正在读取视频素材…")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => (
      String(input).endsWith("/storyboard/jobs/latest")
    ))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });

  it("offers same-job retry only for a safely retryable source read failure", async () => {
    const failedJob = {
      job_id: "storyboard-job-failed",
      status: "failed",
      stage: "failed",
      retryable: true,
      message: "素材读取失败，可以从同一任务重试。",
      error_code: "source_read_failed",
      storyboard: null,
      follow_up_status: null,
      animation_job_id: null,
      animation_job_status: null,
    };
    const queuedJob = { ...failedJob, status: "queued", stage: "queued", retryable: false, message: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/retry")) {
        return new Response(JSON.stringify(queuedJob), { status: 200 });
      }
      if (url.endsWith("/storyboard")) {
        return new Response(JSON.stringify({ detail: "storyboard unavailable" }), { status: 409 });
      }
      if (url.endsWith("/storyboard/jobs/storyboard-job-failed")) {
        return new Response(JSON.stringify(queuedJob), { status: 200 });
      }
      return new Response(JSON.stringify(failedJob), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const dialog = await openVideoDetailsFor(row, "token-retry-storyboard");
    fireEvent.click(await within(dialog).findByRole("button", { name: "重试自动分镜" }));
    expect(await within(dialog).findByText("正在准备自动分镜…")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input, init]) => (
      String(input).endsWith("/retry") && init?.method === "POST"
    ))).toHaveLength(1);
  });
});
