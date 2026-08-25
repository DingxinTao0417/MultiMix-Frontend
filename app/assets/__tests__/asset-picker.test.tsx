// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { StrictMode, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AssetPicker from "../components/asset-picker";

const recommended = [{
  id: "42",
  title: "施工过程记录",
  thumbnailUrl: "https://example.com/work.jpg",
  reason: "匹配“施工过程”和“工人操作”",
}];

describe("AssetPicker confirmation flow", () => {
  it("traps focus, isolates the background, and restores the trigger in Strict Mode", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <div data-testid="picker-background" aria-hidden="false">
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.blur();
                setOpen(true);
              }}
            >
              打开素材选择器
            </button>
          </div>
          <div data-testid="picker-preisolated" aria-hidden="true" inert>
            原有隔离区域
          </div>
          <AssetPicker
            open={open}
            title="为分镜 #2 换素材"
            recommended={recommended}
            library={[]}
            onSelect={vi.fn()}
            onClose={() => setOpen(false)}
          />
        </>
      );
    }

    render(<StrictMode><Harness /></StrictMode>);
    const trigger = screen.getByRole("button", { name: "打开素材选择器" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "为分镜 #2 换素材" });
    const close = within(dialog).getByRole("button", { name: "关闭" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(screen.getByTestId("picker-background")).toHaveAttribute("inert");
    expect(screen.getByTestId("picker-background")).toHaveAttribute("aria-hidden", "true");

    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    const last = focusable.at(-1)!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(screen.getByTestId("picker-background")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("picker-background")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTestId("picker-preisolated")).toHaveAttribute("inert");
    expect(screen.getByTestId("picker-preisolated")).toHaveAttribute("aria-hidden", "true");
  });

  it("selects a recommendation before submitting the replacement", () => {
    const onSelect = vi.fn();
    render(
      <AssetPicker
        open
        title="为分镜 #2 换素材"
        subtitle="替换后只更新当前分镜，不影响其他分镜。"
        ratio="16:9"
        recommended={recommended}
        library={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "为分镜 #2 换素材" });
    expect(dialog).toHaveClass("ratio-landscape");
    const confirm = screen.getByRole("button", { name: "确认替换" });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /施工过程记录/ }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(confirm).toBeEnabled();
    expect(screen.getByRole("button", { name: /施工过程记录/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(confirm);
    expect(onSelect).toHaveBeenCalledWith(recommended[0]);
  });

  it("keeps a selected candidate when asynchronous data refreshes change the close callback", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <AssetPicker
        open
        title="为分镜 #2 换素材"
        recommended={recommended}
        library={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /施工过程记录/ }));
    expect(screen.getByRole("button", { name: "确认替换" })).toBeEnabled();

    rerender(
      <AssetPicker
        open
        title="为分镜 #2 换素材"
        recommended={recommended}
        library={[]}
        publicItems={[{ id: "pub-1", title: "公共素材", candidateId: "pub-1" }]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认替换" }));
    expect(onSelect).toHaveBeenCalledWith(recommended[0]);
  });

  it("closes without replacing when the user cancels", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <AssetPicker
        open
        title="为分镜 #3 换素材"
        ratio="9:16"
        recommended={recommended}
        library={[]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveClass("ratio-portrait");
    fireEvent.click(screen.getByRole("button", { name: /施工过程记录/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("uses the understood material-library label", () => {
    render(
      <AssetPicker
        open
        title="为分镜 #1 换素材"
        library={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("素材库 · 已理解的素材")).toBeInTheDocument();
    expect(screen.getByText("素材库暂时没有已理解的素材。")).toBeInTheDocument();
  });

  it("shows the current material as a non-selectable chip", () => {
    const onSelect = vi.fn();
    render(
      <AssetPicker
        open
        title="为分镜 #1 换素材"
        current={[{ id: "cur", title: "当前门店图", selectable: false, relevanceStatus: "current" }]}
        library={[]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    const currentButton = screen.getByRole("button", { name: /当前门店图/ });
    expect(currentButton).toBeDisabled();
    fireEvent.click(currentButton);
    // Confirming stays disabled because the current chip is not selectable.
    expect(screen.getByRole("button", { name: "确认替换" })).toBeDisabled();
  });

  it("renders public candidates with source metadata and a load-more control", () => {
    const onLoadMorePublic = vi.fn();
    render(
      <AssetPicker
        open
        title="为分镜 #1 换素材"
        library={[]}
        publicItems={[{
          id: "pub-1",
          title: "门店安装",
          candidateId: "pub-1",
          mediaType: "video",
          provider: "pexels",
          author: "Jane",
          durationSeconds: 8,
          requiresTrim: true,
          relevanceReason: "由结构化搜索召回",
          selectable: true,
        }]}
        hasMorePublic
        onLoadMorePublic={onLoadMorePublic}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("公共素材")).toBeInTheDocument();
    expect(screen.getByText(/pexels/)).toBeInTheDocument();
    const loadMore = screen.getByRole("button", { name: "换一批" });
    fireEvent.click(loadMore);
    expect(onLoadMorePublic).toHaveBeenCalledTimes(1);
  });

  it("shows a public provider error without hiding the library group", () => {
    render(
      <AssetPicker
        open
        title="为分镜 #1 换素材"
        library={[{ id: "42", title: "门店图片" }]}
        publicError="公共素材暂时不可用，请稍后重试。"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("公共素材暂时不可用，请稍后重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /门店图片/ })).toBeInTheDocument();
  });
});
