// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarkdownProductDocument from "../components/markdown-product-document";

const { markdownRenderSpy } = vi.hoisted(() => ({
  markdownRenderSpy: vi.fn(),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    markdownRenderSpy(children);
    return <div>{children}</div>;
  },
}));

describe("MarkdownProductDocument", () => {
  it("skips parsing unchanged Markdown but parses changed content", () => {
    const { rerender } = render(<MarkdownProductDocument markdown="# 第一版" />);
    expect(markdownRenderSpy).toHaveBeenCalledTimes(1);

    rerender(<MarkdownProductDocument markdown="# 第一版" />);
    expect(markdownRenderSpy).toHaveBeenCalledTimes(1);

    rerender(<MarkdownProductDocument markdown="# 第二版" />);
    expect(markdownRenderSpy).toHaveBeenCalledTimes(2);
  });
});
