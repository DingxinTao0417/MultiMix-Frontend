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

describe("video library creation actions", () => {
  it("starts video creation from the generic creation action", async () => {
    const onUseAsset = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [row], nextOffset: null });

    render(<LibraryWorkshop view="video" token="token" onUseAsset={onUseAsset} />);

    const dialog = await openVideoDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: "用于创作" }));

    expect(onUseAsset).toHaveBeenCalledWith(row, "video");
  });

  it("can add a saved video to the current conversation", async () => {
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
    fireEvent.click(within(dialog).getByRole("button", { name: "加入对话" }));

    expect(onAddAssetToConversation).toHaveBeenCalledWith(row);
  });
});
