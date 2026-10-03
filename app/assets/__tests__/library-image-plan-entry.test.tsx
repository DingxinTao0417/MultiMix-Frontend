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

function imageRow(): LibraryRow {
  return {
    assetId: 92,
    title: "品牌主视觉",
    meta: "图片 · 已入库",
    note: "门店活动主图",
    kind: "image",
    category: "素材图",
    contentType: "图片",
    contentTypeCode: "uploaded_image",
    statusLabel: "已入库",
    updatedLabel: "刚刚",
  };
}

describe("image library entry", () => {
  it("does not expose a generic image-generation action from the library", async () => {
    const row = imageRow();
    const onUseAsset = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({
      rows: [row],
      nextOffset: null,
    });

    render(<LibraryWorkshop view="image" token="token-image-plan" onUseAsset={onUseAsset} />);

    const grid = await screen.findByLabelText("图片库列表");
    fireEvent.click(within(grid).getByRole("button"));
    const dialog = await screen.findByRole("dialog", { name: "品牌主视觉详情" });
    expect(within(dialog).queryByRole("button", { name: "生成图片方案" })).toBeNull();

    expect(onUseAsset).not.toHaveBeenCalled();
  });

  it("opens the exact requested source detail even when it is absent from the current library page", async () => {
    const row = { ...imageRow(), assetId: 902, title: "项目源图" };
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [imageRow()], nextOffset: null });
    const getLibraryAsset = vi.spyOn(assetWorkspaceAdapter, "getLibraryAsset").mockResolvedValue(row);

    render(<LibraryWorkshop view="image" token="token-image-focus" focusAssetId={902} />);

    expect(await screen.findByRole("dialog", { name: "项目源图详情" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "品牌主视觉详情" })).not.toBeInTheDocument();
    expect(getLibraryAsset).toHaveBeenCalledWith("token-image-focus", 902, expect.any(Object));
    expect(screen.queryByText(/正在为项目.*添加素材/)).not.toBeInTheDocument();
  });

  it("shows a visible failure instead of opening an unrelated detail", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [imageRow()], nextOffset: null });
    vi.spyOn(assetWorkspaceAdapter, "getLibraryAsset").mockRejectedValue(new Error("素材不存在"));

    render(<LibraryWorkshop view="image" token="token-image-focus-error" focusAssetId={902} />);

    expect(await screen.findByText("无法打开项目资料：素材不存在")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "品牌主视觉详情" })).not.toBeInTheDocument();
  });

  it("keeps an archived project source detail read-only", async () => {
    const row = { ...imageRow(), assetId: 903, title: "已归档门店照", archived: true, statusLabel: "已归档" };
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [], nextOffset: null });
    vi.spyOn(assetWorkspaceAdapter, "getLibraryAsset").mockResolvedValue(row);

    render(<LibraryWorkshop
      view="image"
      token="token-archived-image"
      focusAssetId={903}
      onUseAsset={vi.fn()}
      onAddAssetToConversation={vi.fn()}
    />);

    const dialog = await screen.findByRole("dialog", { name: "已归档门店照详情" });
    expect(within(dialog).getByText(/仅可查看历史内容/)).toBeInTheDocument();
    expect(within(dialog).getByText(/归档前未完成素材理解/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/等待开始素材理解/)).not.toBeInTheDocument();
    for (const label of ["用于创作", "加入项目…", "重新解析素材", "删除", "下载"]) {
      expect(within(dialog).queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});
