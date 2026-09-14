// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConfirmationDialog from "../confirmation-dialog";

afterEach(cleanup);

describe("ConfirmationDialog", () => {
  it("names the exact action and keeps cancel free of side effects", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmationDialog
        open
        title="移出项目？"
        description="只影响今后的生成，旧作品不会改变。"
        confirmLabel="移出项目"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "移出项目？" })).toHaveTextContent("旧作品不会改变");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses an explicit danger action", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmationDialog
        open
        title="永久删除源文件？"
        description="删除后无法恢复。"
        confirmLabel="永久删除"
        tone="danger"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "永久删除" });
    expect(confirm).toHaveClass("danger");
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
