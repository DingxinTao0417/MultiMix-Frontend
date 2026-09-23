// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("hides zero-count categories and keeps history as a secondary source view", async () => {
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 1, historicalSources: 2, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue(sourcePage)}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    expect(await screen.findByText("本项目资料")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "素材 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文案 0" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "封面 0" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "视频 0" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "可用于后续生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已移出 2" })).toBeInTheDocument();
  });

  it("explains future-only removal before changing project membership", async () => {
    const loadResources = vi.fn().mockResolvedValue(sourcePage);
    const onRemoveSource = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 1, historicalSources: 0, copies: 0, covers: 0, videos: 0 }}
        loadResources={loadResources}
        onClose={vi.fn()}
        onRemoveSource={onRemoveSource}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "移出项目" }));
    expect(screen.getByRole("dialog", { name: "将素材移出项目？" })).toBeInTheDocument();
    expect(screen.getByText(/这只影响之后的生成/)).toBeInTheDocument();
    expect(screen.getByText(/已有文案、封面和视频不会改变/)).toBeInTheDocument();
    expect(onRemoveSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "将素材移出项目？" })).not.toBeInTheDocument();
    expect(onRemoveSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "移出项目" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "将素材移出项目？" })).getByRole("button", { name: "移出项目" }));
    await waitFor(() => expect(onRemoveSource).toHaveBeenCalledWith(11));
  });

  it("lets a user explicitly choose one active source for the next request without generating", async () => {
    const onUseSourceForNextMessage = vi.fn();

    render(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 1, historicalSources: 0, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue(sourcePage)}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
        onUseSourceForNextMessage={onUseSourceForNextMessage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "用于本轮" }));

    expect(onUseSourceForNextMessage).toHaveBeenCalledWith(sourcePage.items[0]);
  });
});
