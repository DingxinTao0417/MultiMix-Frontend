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

function sourceRow(contentTypeCode = "long_form_video_source"): LibraryRow {
  return {
    assetId: 91,
    title: "访谈第 12 期",
    meta: "视频 · 已入库",
    note: "双人商业访谈原片",
    kind: "video",
    category: "实景拍摄视频",
    contentType: "视频",
    contentTypeCode,
    statusLabel: "已入库",
    updatedLabel: "刚刚",
  };
}

describe("long-form source entry from the video library", () => {
  it("does not offer a dedicated repurpose action while long-form creation is out of scope", async () => {
    const row = sourceRow();
    const onUseAsset = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows: [row],
      nextOffset: null,
    });

    render(<LibraryWorkshop view="video" token="token-long-form-source" onUseAsset={onUseAsset} />);

    const grid = await screen.findByLabelText("视频库列表");
    fireEvent.click(within(grid).getByRole("button"));
    const dialog = await screen.findByRole("dialog", { name: "访谈第 12 期详情" });
    expect(within(dialog).queryByRole("button", { name: "拆成短视频" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "用于创作" })).toBeInTheDocument();
    expect(onUseAsset).not.toHaveBeenCalled();
  });

  it("does not offer repurposing for an ordinary rendered video", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows: [sourceRow("video_project")],
      nextOffset: null,
    });

    render(<LibraryWorkshop view="video" token="token-rendered-video" onUseAsset={vi.fn()} />);

    const grid = await screen.findByLabelText("视频库列表");
    fireEvent.click(within(grid).getByRole("button"));
    const dialog = await screen.findByRole("dialog", { name: "访谈第 12 期详情" });
    expect(within(dialog).queryByRole("button", { name: "拆成短视频" })).not.toBeInTheDocument();
  });
});
