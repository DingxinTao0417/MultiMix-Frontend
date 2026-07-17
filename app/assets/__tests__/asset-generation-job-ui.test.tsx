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
  ...overrides,
});

describe("AssetGenerationJobCard", () => {
  afterEach(cleanup);

  it("shows queued and running progress", () => {
    const { rerender } = render(<AssetGenerationJobCard job={job({})} />);
    expect(screen.getByText("内容生成已排队")).not.toBeNull();

    rerender(<AssetGenerationJobCard job={job({ status: "running", stage: "generating" })} />);
    expect(screen.getByText("正在生成内容…")).not.toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "重试生成" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
  });
});
