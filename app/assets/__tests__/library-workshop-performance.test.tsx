// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function videoRow(index: number): LibraryRow {
  return {
    assetId: index + 1,
    title: `视频条目 ${index + 1}`,
    meta: "视频素材 · 已理解",
    note: "视频素材",
    kind: "video",
    category: "混剪视频",
    statusLabel: "已理解",
    updatedLabel: "刚刚",
    updatedAtIso: new Date(Date.UTC(2026, 6, 24, 3, 0, index)).toISOString(),
    previewUrl: `https://cdn.example/video-${index + 1}.mp4`,
    thumbnailUrl: `https://cdn.example/video-${index + 1}.jpg`,
  };
}

function imageRow(): LibraryRow {
  return {
    assetId: 91,
    title: "已保存场景图",
    meta: "图片素材 · 已理解",
    note: "产品使用场景",
    kind: "image",
    category: "分镜图",
    statusLabel: "已理解",
    updatedLabel: "刚刚",
    updatedAtIso: new Date(Date.UTC(2026, 6, 24, 3, 0, 0)).toISOString(),
    previewUrl: "https://cdn.example/scene.png",
  };
}

describe("library workshop performance boundaries", () => {
  it("starts only one first-page request under development Strict Mode", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const listLibrary = vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows: [videoRow(0)],
      nextOffset: null,
    });

    render(
      <StrictMode>
        <LibraryWorkshop view="video" token="token-strict-mode" />
      </StrictMode>,
    );

    await screen.findByLabelText("视频库列表");
    expect(listLibrary).toHaveBeenCalledTimes(1);
  });

  it("does not mount playable video elements for list cards", async () => {
    const rows = Array.from({ length: 48 }, (_, index) => videoRow(index));
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue(
      { rows, nextOffset: null },
    );

    const { container } = render(<LibraryWorkshop view="video" token="token-media" />);

    const grid = await screen.findByLabelText("视频库列表");
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(48);

    fireEvent.click(within(grid).getAllByRole("button")[0]);
    expect(await screen.findByRole("dialog", { name: "视频条目 1详情" })).toBeInTheDocument();
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("renders one page and appends the next page on demand", async () => {
    const firstRows = Array.from({ length: 48 }, (_, index) => videoRow(index));
    const secondRows = Array.from({ length: 12 }, (_, index) => videoRow(index + 48));
    const firstPage = Object.assign(firstRows, { rows: firstRows, nextOffset: 48 });
    const secondPage = Object.assign(secondRows, { rows: secondRows, nextOffset: null });
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const listLibrary = vi.spyOn(assetWorkspaceAdapter, "listLibrary")
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(secondPage as never);

    render(<LibraryWorkshop view="video" token="token-page" />);

    const grid = await screen.findByLabelText("视频库列表");
    expect(within(grid).getAllByRole("button")).toHaveLength(48);
    const loadMore = screen.getByRole("button", { name: "加载更多" });
    fireEvent.click(loadMore);

    await waitFor(() => expect(within(grid).getAllByRole("button")).toHaveLength(60));
    expect(listLibrary).toHaveBeenNthCalledWith(
      2,
      "token-page",
      "video",
      "",
      expect.objectContaining({ offset: 48, limit: 48, signal: expect.any(AbortSignal) }),
    );
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("reuses a fresh first page until the refresh revision changes", async () => {
    const rows = [videoRow(0)];
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    const listLibrary = vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows,
      nextOffset: null,
    });

    const firstRender = render(<LibraryWorkshop view="video" token="token-cache" />);
    await screen.findByLabelText("视频库列表");
    firstRender.unmount();

    const secondRender = render(<LibraryWorkshop view="video" token="token-cache" />);
    await screen.findByLabelText("视频库列表");
    expect(listLibrary).toHaveBeenCalledTimes(1);

    secondRender.rerender(
      <LibraryWorkshop view="video" token="token-cache" refreshRevision={1} />,
    );
    await waitFor(() => expect(listLibrary).toHaveBeenCalledTimes(2));
  });

  it("can add a saved image to the current conversation", async () => {
    const row = imageRow();
    const onAddAssetToConversation = vi.fn();
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows: [row],
      nextOffset: null,
    });

    render(
      <LibraryWorkshop
        view="image"
        token="token-image-reference"
        onAddAssetToConversation={onAddAssetToConversation}
      />,
    );

    const grid = await screen.findByLabelText("图片库列表");
    fireEvent.click(within(grid).getByRole("button"));
    const dialog = await screen.findByRole("dialog", { name: "已保存场景图详情" });
    fireEvent.click(within(dialog).getByRole("button", { name: "加入对话" }));

    expect(onAddAssetToConversation).toHaveBeenCalledWith(row);
  });
});
