import { describe, expect, it } from "vitest";

import type { AssetGenerationJobResponse } from "../../../lib/api";
import { generationTimelineSteps } from "../lib/asset-generation-progress";

describe("asset generation progress", () => {
  it("times the active stage from its event instead of the historical job start", () => {
    const job: AssetGenerationJobResponse = {
      id: "asset-generation-job-elapsed",
      status: "running",
      result_asset_id: null,
      error_message: null,
      created_at: "2026-08-29T02:00:00Z",
      updated_at: "2026-08-29T10:00:05Z",
      started_at: "2026-08-29T02:00:01Z",
      progress_events: [
        {
          key: "drafting",
          label: "正在生成初稿",
          detail: "",
          status: "completed",
          occurred_at: "2026-08-29T02:00:01Z",
        },
        {
          key: "structuring_director_script",
          label: "正在整理编导稿",
          detail: "",
          status: "active",
          occurred_at: "2026-08-29T10:00:00Z",
        },
      ],
    };

    const steps = generationTimelineSteps(job, Date.parse("2026-08-29T10:00:05Z"));

    expect(steps[1].elapsedSeconds).toBe(5);
    expect(steps[1].elapsedLabel).toBe("已耗时 5 秒");
  });
});
