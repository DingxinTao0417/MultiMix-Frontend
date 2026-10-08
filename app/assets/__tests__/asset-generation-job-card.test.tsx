// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { AssetGenerationJobCard } from "../components/asset-generation-job-card";

afterEach(cleanup);

it.each(["general", "video_plan"] as const)("offers stopped %s continuation only with the server capability", (progress_kind) => {
  const job = { ...failedSourceJob(), status: "cancelled" as const, progress_kind, failure_context: undefined, failure_diagnostic: undefined };
  const onRetry = vi.fn();
  const view = render(<AssetGenerationJobCard job={{ ...job, regenerable: false }} onRetry={onRetry} />);
  if (progress_kind === "general") fireEvent.click(screen.getByRole("button", { name: /进度/ }));
  expect(screen.queryByRole("button", { name: "继续生成" })).not.toBeInTheDocument();
  view.rerender(<AssetGenerationJobCard job={{ ...job, regenerable: true }} onRetry={onRetry} />);
  fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
  expect(onRetry).toHaveBeenCalledWith("job-1");
});

function failedSourceJob(): AssetGenerationJobResponse {
  return {
    id: "job-1",
    progress_kind: "video_plan",
    status: "failed",
    result_asset_id: null,
    error_message: "第 2、3 镜的当前画面方式没能呈现目标。",
    retryable: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    failure_context: { stage: "primary_visual_strategy", source_asset_id: 7, actions: [] },
    failure_diagnostic: {
      error_code: "source_choice_required",
      stage: "primary_visual_strategy",
      scene_ids: ["scene-2", "scene-3"],
    },
  };
}

it("opens the retained director scene instead of retrying an unrenderable visual", () => {
  const onOpenSourceScene = vi.fn();
  render(<AssetGenerationJobCard job={failedSourceJob()} onOpenSourceScene={onOpenSourceScene} />);
  const choices = screen.getByRole("region", { name: "需要选择画面来源" });
  fireEvent.click(within(choices).getByRole("button", { name: "查看第 2 镜并选择画面" }));
  expect(onOpenSourceScene).toHaveBeenCalledWith(7, "scene-2");
  expect(within(choices).getByRole("button", { name: "查看第 3 镜并选择画面" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
});

it("does not offer a scene action without a source director identity", () => {
  const job = failedSourceJob();
  job.failure_context = { stage: "primary_visual_strategy", actions: [] };
  render(<AssetGenerationJobCard job={job} onOpenSourceScene={vi.fn()} />);
  expect(screen.queryByRole("region", { name: "需要选择画面来源" })).not.toBeInTheDocument();
});
