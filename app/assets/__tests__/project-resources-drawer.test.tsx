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
    expect(screen.getByRole("button", { name: "素材 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文案 0" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "封面 0" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "视频 0" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "可用于后续生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "历史资料 2" })).toBeInTheDocument();
  });

  it("shows historical sources as the only category and allows rejoining", async () => {
    const historicalPage = {
      ...sourcePage,
      items: sourcePage.items.map((item) => ({ ...item, membershipState: "removed" as const, readdStatus: "available" as const })),
    };
    const loadResources = vi.fn().mockResolvedValue(historicalPage);
    const onReaddSource = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="历史素材项目"
        summary={{ sources: 0, historicalSources: 1, copies: 0, covers: 0, videos: 0 }}
        loadResources={loadResources}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={onReaddSource}
        onOpenResource={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "素材 1" })).toBeInTheDocument();
    expect(await screen.findByText("门店实拍")).toBeInTheDocument();
    expect(loadResources).toHaveBeenCalledWith("source", "history", 0, 20);
    fireEvent.click(screen.getByRole("button", { name: "重新加入项目" }));
    await waitFor(() => expect(onReaddSource).toHaveBeenCalledWith(11));
  });

  it("keeps an archived historical source visible without offering a rejected rejoin", async () => {
    const onReaddSource = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="历史素材项目"
        summary={{ sources: 0, historicalSources: 1, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue({
          ...sourcePage,
          items: [{ ...sourcePage.items[0], membershipState: "removed", readdStatus: "archived" }],
        })}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={onReaddSource}
        onOpenResource={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
    expect(screen.getByText(/源文件已从资源库删除，无法重新加入/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加入项目" })).not.toBeInTheDocument();
    expect(screen.queryByText(/可随时重新加入/)).not.toBeInTheDocument();
    expect(onReaddSource).not.toHaveBeenCalled();
  });

  it("shows an archived active membership as unavailable history without mutation actions", async () => {
    const onOpenResource = vi.fn();
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 0, historicalSources: 1, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue({
          ...sourcePage,
          items: [{ ...sourcePage.items[0], membershipState: "unavailable", readdStatus: "archived", status: "archived" }],
        })}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={onOpenResource}
        onUseSourceForNextMessage={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
    expect(screen.getByText(/已归档 · 旧版本引用 2 次/)).toBeInTheDocument();
    expect(screen.getByText(/暂不能用于后续创作/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移出项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加入项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "用于本轮" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "永久删除源文件" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "门店实拍" }));
    expect(onOpenResource).toHaveBeenCalled();
  });

  it("does not offer rejoining while a historical source is not ready", async () => {
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="历史素材项目"
        summary={{ sources: 0, historicalSources: 1, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue({
          ...sourcePage,
          items: [{ ...sourcePage.items[0], membershipState: "removed", readdStatus: "not_ready", status: "processing" }],
        })}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
    expect(screen.getByText(/源文件暂不可用，无法重新加入/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加入项目" })).not.toBeInTheDocument();
  });

  it("does not guess rejoin eligibility when an older server omits the field", async () => {
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="历史素材项目"
        summary={{ sources: 0, historicalSources: 1, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue({
          ...sourcePage,
          items: [{ ...sourcePage.items[0], membershipState: "removed" }],
        })}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
    expect(screen.getByText(/源文件状态待确认，暂不能重新加入/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加入项目" })).not.toBeInTheDocument();
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

  it("returns to the current-source view when the last historical source is rejoined", async () => {
    const historicalPage: ProjectResourcePage = {
      ...sourcePage,
      items: [{ ...sourcePage.items[0], id: 12, title: "旧素材", membershipState: "removed" }],
    };
    const loadResources = vi.fn().mockImplementation(async (_kind, scope) => scope === "history" ? historicalPage : sourcePage);
    const sharedProps = {
      open: true,
      projectTitle: "门店讲解视频",
      loadResources,
      onClose: vi.fn(),
      onRemoveSource: vi.fn(),
      onReaddSource: vi.fn(),
      onOpenResource: vi.fn(),
    };
    const view = render(
      <ProjectResourcesDrawer {...sharedProps} summary={{ sources: 1, historicalSources: 1, copies: 0, covers: 0, videos: 0 }} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "历史资料 1" }));
    expect(await screen.findByRole("button", { name: "旧素材" })).toBeInTheDocument();
    view.rerender(
      <ProjectResourcesDrawer {...sharedProps} summary={{ sources: 2, historicalSources: 0, copies: 0, covers: 0, videos: 0 }} />,
    );

    await waitFor(() => expect(loadResources).toHaveBeenLastCalledWith("source", "active", 0, 20));
    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
    expect(screen.queryByText("还没有历史资料。")).not.toBeInTheDocument();
  });

  it("forgets the prior scope and page when the drawer closes and reopens", async () => {
    const historicalPage: ProjectResourcePage = {
      ...sourcePage,
      items: [{ ...sourcePage.items[0], id: 12, title: "旧素材", membershipState: "removed" }],
    };
    const loadResources = vi.fn().mockImplementation(async (_kind, scope) => scope === "history" ? historicalPage : sourcePage);
    const sharedProps = {
      projectTitle: "门店讲解视频",
      summary: { sources: 1, historicalSources: 1, copies: 0, covers: 0, videos: 0 },
      loadResources,
      onClose: vi.fn(),
      onRemoveSource: vi.fn(),
      onReaddSource: vi.fn(),
      onOpenResource: vi.fn(),
    };
    const view = render(<ProjectResourcesDrawer {...sharedProps} open />);
    fireEvent.click(await screen.findByRole("button", { name: "历史资料 1" }));
    expect(await screen.findByRole("button", { name: "旧素材" })).toBeInTheDocument();

    view.rerender(<ProjectResourcesDrawer {...sharedProps} open={false} />);
    view.rerender(<ProjectResourcesDrawer {...sharedProps} open />);

    await waitFor(() => expect(loadResources).toHaveBeenLastCalledWith("source", "active", 0, 20));
    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
  });

  it("returns to the last valid page when the server total shrinks", async () => {
    const firstPage: ProjectResourcePage = { ...sourcePage, total: 21 };
    const lastPage: ProjectResourcePage = {
      ...sourcePage,
      items: [{ ...sourcePage.items[0], id: 31, title: "最后一条素材" }],
      total: 21,
      offset: 20,
    };
    const loadResources = vi.fn().mockImplementation(async (_kind, _scope, offset) => offset === 20 ? lastPage : firstPage);
    const shrunkLoadResources = vi.fn().mockImplementation(async (_kind, _scope, offset) => offset === 20
      ? { ...lastPage, items: [], total: 20 }
      : { ...firstPage, total: 20 });
    const sharedProps = {
      open: true,
      projectTitle: "门店讲解视频",
      summary: { sources: 21, historicalSources: 0, copies: 0, covers: 0, videos: 0 },
      onClose: vi.fn(),
      onRemoveSource: vi.fn(),
      onReaddSource: vi.fn(),
      onOpenResource: vi.fn(),
    };
    const view = render(
      <ProjectResourcesDrawer
        {...sharedProps}
        loadResources={loadResources}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("button", { name: "最后一条素材" })).toBeInTheDocument();
    view.rerender(<ProjectResourcesDrawer {...sharedProps} loadResources={shrunkLoadResources} />);
    await waitFor(() => expect(shrunkLoadResources).toHaveBeenLastCalledWith("source", "active", 0, 20));
    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
    expect(screen.queryByText("这里还没有资料。")).not.toBeInTheDocument();
  });

  it("clamps the page immediately when the project summary loses its last page", async () => {
    const pageOne: ProjectResourcePage = { ...sourcePage, total: 21 };
    const pageTwo: ProjectResourcePage = {
      ...sourcePage,
      items: [{ ...sourcePage.items[0], id: 31, title: "最后一条素材" }],
      total: 21,
      offset: 20,
    };
    let serverTotal = 21;
    const loadResources = vi.fn().mockImplementation(async (_kind, _scope, offset) => serverTotal === 20
      ? { ...pageOne, total: 20, offset, items: offset === 20 ? [] : pageOne.items }
      : offset === 20 ? pageTwo : pageOne);
    const sharedProps = {
      open: true,
      projectTitle: "门店讲解视频",
      loadResources,
      onClose: vi.fn(),
      onRemoveSource: vi.fn(),
      onReaddSource: vi.fn(),
      onOpenResource: vi.fn(),
    };
    const view = render(
      <ProjectResourcesDrawer {...sharedProps} summary={{ sources: 21, historicalSources: 0, copies: 0, covers: 0, videos: 0 }} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("button", { name: "最后一条素材" })).toBeInTheDocument();

    serverTotal = 20;
    view.rerender(
      <ProjectResourcesDrawer {...sharedProps} summary={{ sources: 20, historicalSources: 0, copies: 0, covers: 0, videos: 0 }} />,
    );
    await waitFor(() => expect(loadResources).toHaveBeenLastCalledWith("source", "active", 0, 20));
    expect(await screen.findByRole("button", { name: "门店实拍" })).toBeInTheDocument();
  });

  it("keeps a real next page available when the summary briefly undercounts the list", async () => {
    const firstPage: ProjectResourcePage = { ...sourcePage, total: 21 };
    const secondPage: ProjectResourcePage = {
      ...sourcePage,
      items: [{ ...sourcePage.items[0], id: 31, title: "服务端第二页素材" }],
      total: 21,
      offset: 20,
    };
    const loadResources = vi.fn().mockImplementation(async (_kind, _scope, offset) => offset === 20 ? secondPage : firstPage);
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="门店讲解视频"
        summary={{ sources: 20, historicalSources: 0, copies: 0, covers: 0, videos: 0 }}
        loadResources={loadResources}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    await waitFor(() => expect(loadResources).toHaveBeenLastCalledWith("source", "active", 20, 20));
    expect(await screen.findByRole("button", { name: "服务端第二页素材" })).toBeInTheDocument();
  });
});
