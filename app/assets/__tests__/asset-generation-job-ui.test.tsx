// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetGenerationJobCard } from "../components/asset-generation-job-card";
import type { AssetGenerationJobResponse } from "../../../lib/api";

const job = (overrides: Partial<AssetGenerationJobResponse>): AssetGenerationJobResponse => ({
  id: "asset-generation-job-1",
  status: "queued",
  stage: "queued",
  attempts: 0,
  result_asset_id: null,
  error_code: null,
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
      stage: "generating",
      progress_events: [{ key: "structuring_director_script", label: "正在整理编导稿", detail: "", status: "active", occurred_at: "2026-07-17T06:00:01Z" }],
    })} />);
    expect(screen.getByText("编导稿生成进度")).not.toBeNull();
    expect(document.querySelector(".shadcn-prototype-agent-run")).not.toBeNull();
    expect(screen.getAllByText("正在整理编导稿").length).toBeGreaterThan(0);
  });

  it("collapses a completed task and lets the user review its steps", () => {
    render(<AssetGenerationJobCard job={job({ status: "completed", stage: "completed", progress_events: [{ key: "drafting", label: "正在生成内容", detail: "", status: "completed", occurred_at: "2026-07-17T06:00:01Z" }, { key: "completed", label: "内容生成已完成", detail: "已保存", status: "completed", occurred_at: "2026-07-17T06:00:02Z" } ] })} />);
    expect(screen.queryByText("已保存")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    expect(screen.getByText("内容生成已完成")).not.toBeNull();
  });

  it("lets the user stop a queued or running generation", () => {
    const onCancel = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({ status: "running", stage: "generating" })}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onCancel).toHaveBeenCalledWith("asset-generation-job-1");
  });

  it("renders a controlled timeout and retries the same job", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          stage: "failed",
          error_code: "provider_timeout",
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

  it("keeps a historical failed job retryable when its saved progress is invalid", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          stage: "failed",
          error_code: "quality_rejected",
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
