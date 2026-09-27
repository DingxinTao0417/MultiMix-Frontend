// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoProgressCard as Card, type VideoProgressCardProps } from "../components/video-progress-card";

const running: VideoProgressCardProps = {
  kind: "video_create", submitted: true, status: "running",
  steps: [
    { key: "prepare_scenes", label: "内部分析", status: "done", elapsedSeconds: 12 },
    { key: "mg_overlay", label: "正在生成动态图形", status: "run", retryJobId: "child-1" },
  ],
};

describe("compact video progress card", () => {
  afterEach(cleanup);
  it("starts collapsed with the current public stage, not generic background guidance", () => {
    const { container } = render(<Card {...running} />);
    expect(screen.getByText("正在生成动态图形")).toBeTruthy();
    expect(screen.queryByText(/可以先离开本对话/)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: "查看进度详情" }).getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toMatch(/Provider|MG|12|共.*步|耗时/);
  });

  it("shows one explicit supplier-delay notice without adding a fake stage", () => {
    render(<Card {...running} providerWaitLabel="模型服务响应慢 · 已等待 3 分 · 本阶段剩余 0 秒" />);

    expect(screen.getByText("模型服务响应慢 · 已等待 3 分 · 本阶段剩余 0 秒")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("shows only concise milestones when explicitly expanded", () => {
    render(<Card {...running} />);
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("内部分析")).toBeTruthy();
    expect(screen.getAllByText("正在生成动态图形")).toHaveLength(2);
  });
  it("names the active public stage and retains the completed stage record", () => {
    render(<Card {...running} steps={[
      { key: "prepare_scenes", label: "正在匹配素材", status: "done" },
      {
        key: "grounding_review",
        label: "正在审核事实边界",
        status: "run",
        elapsedLabel: "已耗时 2 分 8 秒",
      },
    ]} />);

    expect(screen.getByText("正在审核事实边界")).toBeTruthy();
    expect(screen.getByText("已耗时 2 分 8 秒")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
    expect(screen.getByText("正在匹配素材")).toBeTruthy();
    expect(screen.getAllByText("正在审核事实边界")).toHaveLength(2);
  });
  it("does not force expansion on failure or retry", () => {
    const { rerender } = render(<Card {...running} />);
    rerender(<Card {...running} status="failed" errorMessage="配音生成失败，可以重试。" />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("配音生成失败，可以重试。")).toBeTruthy();
    rerender(<Card {...running} status="queued" />);
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("preserves an open panel while retrying", () => {
    const { rerender } = render(<Card {...running} status="failed" />);
    fireEvent.click(screen.getByRole("button", { name: "查看进度详情" }));
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
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledExactlyOnceWith("child-1");
    expect(screen.queryByRole("list")).toBeNull();
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
    expect(screen.getAllByText("正在生成动态图形")).toHaveLength(2);
  });
  it("does not expose stale errors after a successful retry", () => {
    render(<Card {...running} status="completed" completionConfirmed errorMessage="旧的失败" />);
    expect(screen.queryByText("旧的失败")).toBeNull();
  });
  it("shows only the recorded list-price subtotal and its missing coverage", () => {
    render(<Card {...running} imageToVideoCostSummary={{
      recordedCallCount: 2, pricedCallCount: 1, unknownCostCallCount: 1,
      standardPriceCostCny: 0.75, historicalCoverage: "since_ledger_enabled",
    }} />);
    expect(screen.getByText(/图生视频.*¥0\.75.*标准原价估算/)).toBeTruthy();
    expect(screen.getByText(/1 次调用费用未知/)).toBeTruthy();
    expect(screen.getByText(/不含留账前调用、渲染和配音/)).toBeTruthy();
  });
  it("shows provider-reported narration characters without inventing a price", () => {
    render(<Card {...running} narrationUsageSummary={{
      recordedCallCount: 2, knownUsageCallCount: 1, unknownUsageCallCount: 1,
      billedTextWords: 12, historicalCoverage: "since_ledger_enabled",
      scope: "main_project_narration",
    }} />);
    expect(screen.getByText(/配音.*12.*计费字符/)).toBeTruthy();
    expect(screen.getByText(/1 次用量未知/)).toBeTruthy();
    expect(screen.getByText(/配音金额未知/)).toBeTruthy();
    expect(screen.getByText(/渲染金额未知/)).toBeTruthy();
  });
  it("does not mistake an empty post-ledger record for zero lifetime spend", () => {
    render(<Card {...running} narrationUsageSummary={{
      recordedCallCount: 0, knownUsageCallCount: 0, unknownUsageCallCount: 0,
      billedTextWords: 0, historicalCoverage: "since_ledger_enabled",
      scope: "main_project_narration",
    }} />);
    expect(screen.getByText(/尚无已留账的调用/)).toBeTruthy();
    expect(screen.queryByText(/¥0\.00/)).toBeNull();
  });
});
