// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomepageShowcase from "../components/homepage-showcase";
import type { HomepageShowcaseCase } from "../lib/homepage-showcase-cases";

const exampleCase: HomepageShowcaseCase = {
  id: "fixture-case",
  title: "示例案例",
  startPath: "修改现有视频",
  provided: "一段原片和修改要求",
  result: "一条修改后的成片",
  posterUrl: "/fixture-poster.jpg",
  videoUrl: "/fixture-result.mp4",
  originalPosterUrl: "/fixture-original.jpg",
  originalVideoUrl: "/fixture-original.mp4",
  process: [
    { label: "需求", summary: "确认保留与调整的部分" },
    { label: "方案", summary: "确定修改范围" },
    { label: "修改", summary: "调整选定片段" },
    { label: "成片", summary: "审核最终版本" },
  ],
  publicDisplayApproval: "test-only-approval-record",
  qualityReviewEvidence: "test-only-review-record",
};

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  vi.restoreAllMocks();
});

describe("HomepageShowcase", () => {
  it("does not show a fake case when no approved public work exists", () => {
    render(<HomepageShowcase />);
    expect(screen.queryByRole("heading", { name: "看看能做出什么" })).not.toBeInTheDocument();
  });

  it("excludes a case without public display approval", () => {
    render(<HomepageShowcase cases={[{ ...exampleCase, publicDisplayApproval: "" }]} />);
    expect(screen.queryByRole("heading", { name: "看看能做出什么" })).not.toBeInTheDocument();
  });

  it("opens a real case structure with controlled final and original videos", async () => {
    render(<HomepageShowcase cases={[exampleCase]} />);

    expect(screen.getByRole("heading", { name: "看看能做出什么" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看「示例案例」的制作过程" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("确认保留与调整的部分");
    expect(dialog).toHaveTextContent("审核最终版本");
    const videos = dialog.querySelectorAll("video");
    expect(videos).toHaveLength(2);
    expect(videos[0]).toHaveAttribute("src", "/fixture-original.mp4");
    expect(videos[1]).toHaveAttribute("src", "/fixture-result.mp4");
    expect(videos[1]).not.toHaveAttribute("autoplay");

    fireEvent.click(screen.getByRole("button", { name: "关闭案例详情" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
