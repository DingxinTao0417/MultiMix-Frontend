// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
});
