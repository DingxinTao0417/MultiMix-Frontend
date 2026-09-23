// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoProgressCard as Card, type VideoProgressCardProps } from "../components/video-progress-card";

const running: VideoProgressCardProps = {
  kind: "video_create", submitted: true, status: "running",
  steps: [
    { key: "prepare_scenes", label: "内部分析", status: "done", elapsedSeconds: 12 },
    { key: "mg_overlay", label: "Provider MG", status: "run", retryJobId: "child-1" },
  ],
};

describe("compact video progress card", () => {
  afterEach(cleanup);
  it("starts collapsed with current state and safe background guidance", () => {
    const { container } = render(<Card {...running} />);
    expect(screen.getByText("正在制作视频")).toBeTruthy();
    expect(screen.getByText(/可以先离开本对话/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: "查看进度详情" }).getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toMatch(/Provider|MG|12|共.*步|耗时/);
  });
  it("shows only concise milestones when explicitly expanded", () => {
    render(<Card {...running} />);
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("准备画面")).toBeTruthy();
    expect(screen.getByText("制作视频")).toBeTruthy();
  });
  it("opens the failed step when a task fails, then keeps it open while retrying", () => {
    const { rerender } = render(<Card {...running} />);
    rerender(<Card {...running} status="failed" errorMessage="配音生成失败，可以重试。" />);
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起失败步骤" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("配音生成失败，可以重试。")).toBeTruthy();
    rerender(<Card {...running} status="queued" />);
    expect(screen.getByRole("list")).toBeTruthy();
  });
  it("preserves an open panel while retrying", () => {
    const { rerender } = render(<Card {...running} status="failed" />);
    expect(screen.getByRole("button", { name: "收起失败步骤" })).toBeTruthy();
    rerender(<Card {...running} status="queued" />);
    expect(screen.getByRole("list")).toBeTruthy();
  });
  it("collapses once on confirmed success, then respects manual expansion", () => {
    const { rerender } = render(<Card {...running} />);
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    rerender(<Card {...running} status="completed" completionConfirmed />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("视频已做好")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    rerender(<Card {...running} status="completed" completionConfirmed steps={[...running.steps]} />);
    expect(screen.getByRole("list")).toBeTruthy();
  });
  it("keeps retry accessible with the original target while collapsed", () => {
    const retry = vi.fn();
    render(<Card {...running} status="failed"
      actions={<button onClick={() => retry("child-1")}>重试</button>} />);
    expect(screen.getByRole("list")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledExactlyOnceWith("child-1");
    expect(screen.getByRole("list")).toBeTruthy();
  });
  it("does not invent a retry or stop action", () => {
    render(<Card {...running} status="failed" />);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    expect(screen.queryByRole("button", { name: "停止生成" })).toBeNull();
  });
  it("leaves stopped-task actions visible with neutral status", () => {
    const { container } = render(<Card {...running} status="cancelled"
      actions={<button>重新生成</button>} />);
    expect(screen.getByRole("button", { name: "重新生成" })).toBeTruthy();
    expect(screen.getByText("本次任务已停止")).toBeTruthy();
    expect(container.querySelector(".shadcn-prototype-agent-run-title-status.cancelled")).toBeTruthy();
  });
  it("shows connection loss without removing real milestones", () => {
    const { rerender } = render(<Card {...running} />);
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    rerender(<Card {...running} connectionLost />);
    expect(screen.getByText("暂时无法更新进度")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    rerender(<Card {...running} connectionLost={false} />);
    expect(screen.getByText("正在制作视频")).toBeTruthy();
  });
  it("does not expose stale errors after a successful retry", () => {
    render(<Card {...running} status="completed" completionConfirmed errorMessage="旧的失败" />);
    expect(screen.queryByText("旧的失败")).toBeNull();
  });
});
