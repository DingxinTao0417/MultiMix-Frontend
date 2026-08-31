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

describe("image library plan entry", () => {
  it("labels the follow-up as an image plan instead of a rendered image", async () => {
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
    fireEvent.click(within(dialog).getByRole("button", { name: "生成图片方案" }));

    expect(onUseAsset).toHaveBeenCalledWith(row, "regenerate-image");
  });
});
