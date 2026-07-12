// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AssetPicker from "../components/asset-picker";

const recommended = [{
  id: "42",
  title: "施工过程记录",
  thumbnailUrl: "https://example.com/work.jpg",
  reason: "匹配“施工过程”和“工人操作”",
}];

describe("AssetPicker confirmation flow", () => {
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
});
