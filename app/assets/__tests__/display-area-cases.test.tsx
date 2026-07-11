// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProductPreview from "../components/product-preview";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(cleanup);

function renderWorkspace(caseId: keyof typeof displayProducts) {
  const product = displayProducts[caseId];
  return render(
    <ProductWorkspace
      copied={false}
      onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)}
      onRetryVideoJob={vi.fn(async () => undefined)}
      product={product}
      selectedConversation={conversationForDisplayProduct(product)}
    />,
  );
}

describe("display-area eight-case matrix", () => {
  it.each([
    ["case-01-director-draft", "编导稿草稿"],
    ["case-02-saved-asset-match", "已引用 测试门店素材"],
    ["case-03-no-asset-hit", "未命中素材"],
    ["case-08-mg-failed-project-ready", "MG 渲染失败，原分镜仍保留"],
  ] as const)("renders %s truthfully", (caseId, expectedText) => {
    render(<ProductPreview product={displayProducts[caseId]} />);
    expect(screen.getAllByText(expectedText, { exact: false }).length).toBeGreaterThan(0);
  });

  it("shows a project preview when the ready project has no MP4", () => {
    render(<ProductPreview product={displayProducts["case-06-project-ready-no-mp4"]} />);
    expect(screen.getByLabelText("视频工程预览")).toBeInTheDocument();
  });

  it("shows the finished-video surface for the MP4 case", () => {
    render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
  });

  it("shows a real saved-asset thumbnail without calling it fallback material", () => {
    render(<ProductPreview product={displayProducts["case-02-saved-asset-match"]} />);
    expect(screen.getByText("已引用 测试门店素材", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("你的素材", { exact: false })).not.toBeInTheDocument();
  });

  it("keeps a running project out of edit and export", () => {
    renderWorkspace("case-04-project-running");
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("视频工程生成中"))).toBe(true);
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出视频" })).not.toBeInTheDocument();
  });

  it("shows a stable failure with retry and no project controls", () => {
    renderWorkspace("case-05-project-failed");
    expect(screen.getByRole("alert")).toHaveTextContent("素材合成步骤失败，请重试");
    expect(screen.getByRole("button", { name: /重试生成/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });

  it.each(["case-06-project-ready-no-mp4", "case-08-mg-failed-project-ready"] as const)(
    "keeps %s editable without pretending an MP4 exists",
    (caseId) => {
      const { container } = renderWorkspace(caseId);
      expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
      expect(container.querySelector("video")).not.toBeInTheDocument();
    },
  );

  it("renders a real video element only for the MP4 case", () => {
    const { container } = render(<ProductPreview product={displayProducts["case-07-project-ready-mp4"]} />);
    expect(container.querySelector("video")).toHaveAttribute("src", expect.stringContaining("display-sample.mp4"));
  });
});
