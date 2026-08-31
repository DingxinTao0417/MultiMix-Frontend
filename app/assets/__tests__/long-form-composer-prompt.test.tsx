// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LongFormComposerPrompt from "../components/long-form-composer-prompt";

describe("long-form composer requirement prompt", () => {
  it("fills an editable requirement without executing it", () => {
    const onFill = vi.fn();
    render(<LongFormComposerPrompt onFill={onFill} />);

    expect(screen.getByText("你想怎么处理这段内容？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "找出值得发布的片段" }));

    expect(onFill).toHaveBeenCalledOnce();
    expect(onFill).toHaveBeenCalledWith("找出这段内容中值得发布的片段");
  });

  it("offers goals instead of a fixed result count", () => {
    render(<LongFormComposerPrompt onFill={vi.fn()} />);

    expect(screen.getByRole("button", { name: "按主题或观点筛选" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "先梳理内容结构" })).toBeInTheDocument();
    expect(screen.queryByText(/Top\s*5/i)).not.toBeInTheDocument();
  });
});
