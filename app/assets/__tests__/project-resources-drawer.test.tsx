// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectResourcesDrawer, {
  type ProjectResourcePage,
} from "../components/project-resources-drawer";

afterEach(cleanup);

const sourcePage: ProjectResourcePage = {
  items: [
    {
      id: 11,
      title: "门店实拍",
      kind: "source",
      membershipState: "active",
      historicalReferenceCount: 2,
      status: "ready",
      assetKind: "image",
      contentType: "uploaded_image",
      sourceType: "upload",
      updatedAt: "2026-08-31T10:00:00Z",
    },
  ],
  total: 1,
  offset: 0,
  limit: 20,
};

describe("ProjectResourcesDrawer", () => {
  it("loads resources only after opening and switches categories on demand", async () => {
    const loadResources = vi.fn().mockResolvedValue(sourcePage);
    const view = render(
      <ProjectResourcesDrawer
        open={false}
        projectTitle="门店讲解视频"
        summary={{ sources: 1, historicalSources: 0, copies: 1, covers: 0, videos: 0 }}
        loadResources={loadResources}
        onClose={vi.fn()}
        onAddSource={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    expect(loadResources).not.toHaveBeenCalled();

    view.rerender(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 1, historicalSources: 0, copies: 1, covers: 0, videos: 0 }}
        loadResources={loadResources}
        onClose={vi.fn()}
        onAddSource={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    expect(await screen.findByText("门店实拍")).toBeInTheDocument();
    expect(loadResources).toHaveBeenCalledWith("source", "active", 0, 20);

    fireEvent.click(screen.getByRole("button", { name: "文案 1" }));
    await waitFor(() => expect(loadResources).toHaveBeenCalledWith("copy", "all", 0, 20));
  });

  it("explains future-only removal before changing project membership", async () => {
    const loadResources = vi.fn().mockResolvedValue(sourcePage);
    const onRemoveSource = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockImplementation((message) => {
      expect(message).toContain("只影响今后的生成");
      expect(message).toContain("旧文案、旧封面和旧视频不会改变");
      return true;
    });

    render(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 1, historicalSources: 0, copies: 0, covers: 0, videos: 0 }}
        loadResources={loadResources}
        onClose={vi.fn()}
        onAddSource={vi.fn()}
        onRemoveSource={onRemoveSource}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "移出项目" }));
    await waitFor(() => expect(onRemoveSource).toHaveBeenCalledWith(11));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
