// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { LibraryWorkspaceErrorBoundary, LibraryWorkspaceLoading } from "../components/library-workspace-state";

describe("library workspace dynamic states", () => {
  it("does not fall back to bundled workshop rows", () => {
    const workshop = readFileSync(resolve(process.cwd(), "app/assets/components/library-workshop.tsx"), "utf8");
    const readyStrip = readFileSync(resolve(process.cwd(), "app/assets/components/materials-ready-strip.tsx"), "utf8");

    expect(workshop).not.toContain("backendRows !== null ? backendRows : workshop.rows");
    expect(workshop).toContain("资源库加载失败");
    expect(workshop).toContain("未连接后端");
    expect(readyStrip).not.toContain('assetWorkspaceAdapter.getWorkshop("image").rows');
  });
  it("shows an accessible image-library loading state", () => {
    render(<LibraryWorkspaceLoading title="图片库" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("正在加载图片库…")).toBeInTheDocument();
  });

  it("shows one reload action when the library body throws", () => {
    const onReload = vi.fn();
    const Broken = () => {
      throw new Error("chunk failed");
    };

    render(
      <LibraryWorkspaceErrorBoundary onReload={onReload}>
        <Broken />
      </LibraryWorkspaceErrorBoundary>,
    );

    expect(screen.getByText("加载失败，请重新加载")).toBeInTheDocument();
    const reload = screen.getByRole("button", { name: "重新加载" });
    fireEvent.click(reload);
    expect(onReload).toHaveBeenCalledOnce();
  });
});
