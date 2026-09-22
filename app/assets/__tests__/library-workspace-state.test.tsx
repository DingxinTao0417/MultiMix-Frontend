// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { LibraryWorkspaceErrorBoundary, LibraryWorkspaceLoading } from "../components/library-workspace-state";

describe("library workspace dynamic states", () => {
  it("does not fall back to bundled workshop rows", () => {
    const workshop = readFileSync(resolve(process.cwd(), "app/assets/components/library-workshop.tsx"), "utf8");

    expect(workshop).not.toContain("backendRows !== null ? backendRows : workshop.rows");
    expect(workshop).toContain("资源库加载失败");
    expect(workshop).toContain("创作服务尚未连接");
    expect(existsSync(resolve(process.cwd(), "app/assets/components/materials-ready-strip.tsx"))).toBe(false);
  });

  it("uses authoritative understanding and completed project state", () => {
    const workshop = readFileSync(resolve(process.cwd(), "app/assets/components/library-workshop.tsx"), "utf8");
    const adapter = readFileSync(resolve(process.cwd(), "app/assets/lib/asset-workspace-adapter.ts"), "utf8");

    expect(workshop).toContain('row.understandingStatus === "ready"');
    expect(workshop).toContain('selectedRow.understandingStatus === "failed"');
    expect(workshop).toContain('selectedRow.contentTypeCode === "video_project"');
    expect(workshop).toContain('selectedRow.productStatus === "completed"');
    expect(workshop).toContain('/editor?asset=');
    expect(workshop).not.toContain("VoiceoverAudioBar");
    expect(adapter).toContain("productStatus: asset.product_status");
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
    expect(screen.getByText("内容暂时无法显示，重新加载后即可继续。")).toBeInTheDocument();
    expect(screen.queryByText(/组件/)).not.toBeInTheDocument();
    const reload = screen.getByRole("button", { name: "重新加载" });
    fireEvent.click(reload);
    expect(onReload).toHaveBeenCalledOnce();
  });
});
