// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetGenerationJobCard } from "../components/asset-generation-job-card";
import type { AssetGenerationJobResponse } from "../../../lib/api";

const job = (overrides: Partial<AssetGenerationJobResponse>): AssetGenerationJobResponse => ({
  id: "asset-generation-job-1",
  status: "queued",
  result_asset_id: null,
  error_message: null,
  created_at: "2026-07-17T06:00:00Z",
  updated_at: "2026-07-17T06:00:01Z",
  started_at: null,
  progress_events: [],
  ...overrides,
});

describe("AssetGenerationJobCard", () => {
  afterEach(cleanup);

  it("shows queued and running progress", () => {
    const { rerender } = render(<AssetGenerationJobCard job={job({})} />);
    expect(screen.getAllByText("内容生成已排队").length).toBeGreaterThan(0);

    rerender(<AssetGenerationJobCard job={job({
      status: "running",
      progress_events: [{ key: "structuring_director_script", label: "正在整理编导稿", detail: "", status: "active", occurred_at: "2026-07-17T06:00:01Z" }],
    })} />);
    expect(screen.getByText("编导稿生成进度")).not.toBeNull();
    expect(document.querySelector(".shadcn-prototype-agent-run")).not.toBeNull();
    expect(screen.getAllByText("正在整理编导稿").length).toBeGreaterThan(0);
  });

  it("shows real byte progress while staging a long-form source", () => {
    render(<AssetGenerationJobCard job={job({
      status: "running",
      progress_events: [{
        key: "source_staging",
        label: "正在准备原片",
        detail: "正在准备原片（18.2 MB / 27.7 MB，66%）。",
        status: "active",
        occurred_at: "2026-08-05T06:00:01Z",
      }],
    })} />);

    expect(screen.getByText("正在准备原片（18.2 MB / 27.7 MB，66%）。")).not.toBeNull();
  });

  it("collapses a completed task and lets the user review its steps", () => {
    render(<AssetGenerationJobCard job={job({ status: "completed", progress_events: [{ key: "drafting", label: "正在生成内容", detail: "", status: "completed", occurred_at: "2026-07-17T06:00:01Z" }, { key: "completed", label: "内容生成已完成", detail: "已保存", status: "completed", occurred_at: "2026-07-17T06:00:02Z" } ] })} />);
    expect(screen.queryByText("已保存")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    expect(screen.getByText("内容生成已完成")).not.toBeNull();
  });

  it("describes a completed director script without claiming the video is ready", () => {
    render(<AssetGenerationJobCard job={job({
      status: "completed",
      progress_events: [
        { key: "structuring_director_script", label: "正在整理编导稿", detail: "", status: "completed", occurred_at: "2026-07-17T06:00:01Z" },
        { key: "completed", label: "编导稿已生成", detail: "已保存", status: "completed", occurred_at: "2026-07-17T06:00:02Z" },
      ],
    })} />);

    expect(screen.getByText(/编导脚本已生成，可确认或修改/)).not.toBeNull();
    expect(screen.queryByText(/视频已生成，可立即编辑/)).toBeNull();
  });

  it("lets the user stop a queued or running generation", () => {
    const onCancel = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({ status: "running" })}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onCancel).toHaveBeenCalledWith("asset-generation-job-1");
  });

  it("keeps the submitted step when a historical stopped job has lost its progress events", () => {
    render(<AssetGenerationJobCard job={job({
      status: "cancelled",
      updated_at: "2026-07-17T06:00:04Z",
    })} />);

    expect(screen.getByRole("button", { name: /共 2 步/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    expect(screen.getByText("内容生成已排队")).not.toBeNull();
    expect(screen.getByText("本次生成已停止")).not.toBeNull();
  });

  it("lets the user explicitly restart a stopped generation", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({ status: "cancelled" })}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
  });

  it("renders a controlled timeout and retries the same job", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          error_message: "AI generation service failed: The read operation timed out",
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("内容生成超时，本轮没有创建产物，可以直接重试。")).not.toBeNull();
    expect(screen.queryByText(/AI generation service failed/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新执行此步骤" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
  });

  it("blocks a second failed-job retry until the first request rejects", async () => {
    let rejectRetry!: (reason?: unknown) => void;
    const pendingRetry = new Promise<void>((_resolve, reject) => {
      rejectRetry = reject;
    });
    const onRetry = vi.fn(() => pendingRetry);
    render(
      <AssetGenerationJobCard
        job={job({ status: "failed" })}
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", { name: "重新执行此步骤" });
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "正在重试…" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "正在重试…" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rejectRetry(new Error("retry rejected"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重新执行此步骤" })).toHaveProperty("disabled", false);
    });
  });

  it("keeps provider diagnostics out of the ordinary failure card", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          error_message: "内容生成服务拒绝了本次请求。",
          failure_diagnostic: {
            error_code: "provider_rejected",
            stage: "presenter_events",
            http_status: 400,
            provider_error_code: "InvalidSchema",
            request_fingerprint: "sha256:body-free",
            attempts: 2,
            fallback: "none",
          },
        })}
      />,
    );

    expect(screen.getByText("内容生成服务拒绝了本次请求。")).not.toBeNull();
    expect(screen.queryByText(/provider_rejected|presenter_events|InvalidSchema|sha256:body-free/)).toBeNull();
  });

  it("keeps a historical failed job retryable when its saved progress is invalid", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          progress_events: [null] as unknown as AssetGenerationJobResponse["progress_events"],
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("内容生成失败，本轮没有创建产物，可以直接重试。")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新执行此步骤" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
  });
});
