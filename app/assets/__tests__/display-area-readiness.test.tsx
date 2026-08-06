// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProductPreview from "../components/product-preview";
import ProductWorkspace from "../components/product-workspace";
import { falseReadyConversation, falseReadyProduct } from "./fixtures/display-products";


describe("display-area project readiness", () => {
  it("does not expose the video browse surface for a false-ready project", () => {
    render(<ProductPreview product={falseReadyProduct} />);

    expect(screen.getByRole("alert")).toHaveTextContent("视频暂不可用");
    expect(screen.queryByLabelText("成片预览")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("视频工程预览")).not.toBeInTheDocument();
    expect(screen.queryByText("编导稿草稿", { exact: true })).not.toBeInTheDocument();
  });

  it("does not expose edit or export controls for a false-ready project", () => {
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={falseReadyProduct}
        selectedConversation={falseReadyConversation}
      />,
    );

    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });
});
