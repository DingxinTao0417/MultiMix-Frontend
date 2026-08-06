// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SourceRefBlock from "../components/source-ref-block";

afterEach(cleanup);

describe("source reference disclosure", () => {
  const summary = {
    headline: "基于 2 个已保存素材生成",
    refs: [
      { id: "asset-1", title: "门店外景" },
      { id: "asset-2", title: "施工过程" },
    ],
    note: "已保存素材命中 2/2",
  };

  it("is collapsed by default and expands from its summary", () => {
    render(<SourceRefBlock summary={summary} />);

    const disclosure = screen.getByLabelText("来源引用");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("门店外景")).not.toBeVisible();

    fireEvent.click(screen.getByText("基于 2 个已保存素材生成"));

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("门店外景")).toBeVisible();
  });

  it("keeps animation information in the same expandable source card", () => {
    render(<SourceRefBlock summary={summary} animation={{
      mode: "自动丰富",
      metrics: ["2 个分镜动态增强", "4 类受控效果"],
    }} />);

    const disclosure = screen.getByLabelText("来源引用");
    expect(disclosure).toContainElement(screen.getByText("动画编排：自动丰富"));
    expect(disclosure).toContainElement(screen.getByText("2 个分镜动态增强"));
  });
});
