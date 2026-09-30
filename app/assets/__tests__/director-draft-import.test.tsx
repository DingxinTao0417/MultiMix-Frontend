// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import { resolveRuntimeWriteCapabilities } from "../lib/runtime-write-capabilities";

const writes = resolveRuntimeWriteCapabilities({
  backendConfigured: true, hasToken: true, connectionState: "available",
});

const source: LibraryRow = {
  assetId: 44, title: "早餐店编导稿", kind: "copy", meta: "已入库", note: "六镜",
  contentTypeCode: "text/markdown", contentHash: "source-hash", sourceTypeCode: "upload",
  fullBody: "# 早餐店\n\n### 1. 开场\n- 画面方向：参考素材#23的暖色调，素材#13的蒸汽感待核对。",
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("director draft import", () => {
  it("requires an existing project and lets the user map one legacy image reference", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockImplementation(async (_token, view) => ({
      rows: view === "copy" ? [source] : [{
        assetId: 201, title: "reference-image-23", kind: "image", meta: "已理解", note: "参考图",
        understandingStatus: "ready",
      }], nextOffset: null,
    }));
    const onImportDirectorDraft = vi.fn().mockResolvedValue(undefined);
    render(<LibraryWorkshop view="copy" token="token" writeCapabilities={writes}
      onImportDirectorDraft={onImportDirectorDraft} importProjectTitle="早餐店项目" />);

    const grid = await screen.findByLabelText("文案库列表");
    fireEvent.click(within(grid).getByRole("button", { name: /早餐店编导稿/ }));
    const dialog = await screen.findByRole("dialog", { name: /早餐店编导稿详情/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "导入为可编辑编导稿" }));
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /reference-image-23/ })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByRole("combobox", { name: "生产参考图" }), { target: { value: "201" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "旧素材编号映射" }), { target: { value: "23" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(onImportDirectorDraft).toHaveBeenCalledWith(source, [201], { "23": 201 }));
    expect(within(dialog).getByText(/未映射的旧编号会保留为待核对项/)).toBeInTheDocument();
  });

  it("does not offer import without a project", async () => {
    vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [source], nextOffset: null });
    render(<LibraryWorkshop view="copy" token="token" writeCapabilities={writes}
      onImportDirectorDraft={vi.fn()} importProjectTitle={null} />);
    const grid = await screen.findByLabelText("文案库列表");
    fireEvent.click(within(grid).getByRole("button", { name: /早餐店编导稿/ }));
    expect(screen.queryByRole("button", { name: "导入为可编辑编导稿" })).not.toBeInTheDocument();
  });
});
