// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetGenerationJobCard } from "../components/asset-generation-job-card";
import type { AssetGenerationJobResponse } from "../../../lib/api";

const job = (
  overrides: Partial<AssetGenerationJobResponse>,
): AssetGenerationJobResponse => ({
  id: "asset-generation-job-1",
  status: "queued",
  result_asset_id: null,
  error_message: null,
  retryable: true,
  created_at: "2026-07-17T06:00:00Z",
  updated_at: "2026-07-17T06:00:01Z",
  started_at: null,
  progress_events: [],
  ...overrides,
});

describe("AssetGenerationJobCard", () => {
  afterEach(cleanup);

  it("shows known visual usage cost without claiming an actual bill", () => {
    render(<AssetGenerationJobCard job={job({
      progress_kind: "video_plan", status: "failed",
      visual_cost_summary: {
        known_standard_cost_cny: "0.001500", known_prompt_tokens: 5000,
        known_completion_tokens: 500, priced_call_count: 1,
        unpriced_call_count: 1, currency: "CNY",
        scope: "visual_analysis_only", basis: "public_list_price_estimate",
      },
    })} />);
    expect(screen.getByText("费用统计")).toBeTruthy();
    expect(screen.getByText(/素材视觉分析标准价估算：¥0\.001500/)).toBeTruthy();
    expect(screen.getByText(/1 次用量未知/)).toBeTruthy();
    expect(screen.getByText(/不是实际账单/)).toBeTruthy();
  });

  it("shows FLUX reservation separately from executed estimate and allocated bill", () => {
    render(<AssetGenerationJobCard job={job({
      progress_kind: "general", status: "failed",
      image_cost_summary: {
        reserved_usd: "0.600000", executed_estimate_usd: "0.400000",
        allocated_billed_usd: "0.130000", executed_call_count: 2,
        allocated_call_count: 1, unpriced_call_count: 0,
        currency: "USD", scope: "flux_reference_image_only",
      },
    })} />);
    expect(screen.getByText(/预留上限：\$0\.600000/)).toBeTruthy();
    expect(screen.getByText(/已执行估算：\$0\.400000/)).toBeTruthy();
    expect(screen.getByText(/账单分摊：\$0\.130000/)).toBeTruthy();
    expect(screen.getByText(/仅 1\/2 次有账单分摊/)).toBeTruthy();
    expect(screen.queryByText(/暂无可核算记录/)).toBeNull();
  });

  it("does not present reservation-only FLUX jobs as already spent", () => {
    render(<AssetGenerationJobCard job={job({
      image_cost_summary: {
        reserved_usd: "1.000000", executed_estimate_usd: "0.000000",
        allocated_billed_usd: "0.000000", executed_call_count: 0,
        allocated_call_count: 0, unpriced_call_count: 0,
        currency: "USD", scope: "flux_reference_image_only",
      },
    })} />);
    expect(screen.getByText(/预留上限：\$1\.000000/)).toBeTruthy();
    expect(screen.getByText(/尚无已执行图片费用记录/)).toBeTruthy();
    expect(screen.queryByText(/已执行估算/)).toBeNull();
  });

  it("marks executed FLUX cost as unknown until billing allocation exists", () => {
    render(<AssetGenerationJobCard job={job({
      image_cost_summary: {
        reserved_usd: "0.200000", executed_estimate_usd: "0.200000",
        allocated_billed_usd: "0.000000", executed_call_count: 1,
        allocated_call_count: 0, unpriced_call_count: 0,
        currency: "USD", scope: "flux_reference_image_only",
      },
    })} />);
    expect(screen.getByText(/已执行估算：\$0\.200000/)).toBeTruthy();
    expect(screen.getByText(/暂无账单分摊，实付未知/)).toBeTruthy();
    expect(screen.queryByText(/账单分摊：\$0\.000000/)).toBeNull();
  });

  it("shows text-model list-price estimate separately from unknown calls", () => {
    render(<AssetGenerationJobCard job={job({
      progress_kind: "video_plan", status: "failed",
      llm_cost_summary: {
        known_standard_cost_cny: "0.002800", known_prompt_tokens: 1000,
        known_completion_tokens: 100, priced_call_count: 1,
        unpriced_call_count: 2, currency: "CNY",
        scope: "text_model_calls_only", basis: "public_list_price_estimate",
      },
    })} />);
    expect(screen.getByText(/编导\/文本模型标准价估算：¥0\.002800/)).toBeTruthy();
    expect(screen.getByText(/2 次费用未知/)).toBeTruthy();
    expect(screen.getByText(/不能据此计算任务总实付/)).toBeTruthy();
    expect(screen.queryByText(/暂无可核算记录/)).toBeNull();
  });

  it("uses video scope immediately while queued, before any director event", () => {
    render(
      <AssetGenerationJobCard job={job({ progress_kind: "video_plan" })} />,
    );
    expect(screen.getByText("视频任务已提交")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("内容生成进度")).toBeNull();
  });

  it("keeps stopped video actions visible without expanding details", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({ progress_kind: "video_plan", status: "cancelled", regenerable: true })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("本次任务已停止")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps video failure and retry outside collapsed details", () => {
    const onRetry = vi.fn();
    render(<AssetGenerationJobCard job={job({
      progress_kind: "video_plan", status: "failed", error_message: "视频方案生成失败，可以重试。",
    })} onRetry={onRetry} />);
    const detailsToggle = screen.getByRole("button", { name: "查看失败步骤" });
    expect(detailsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("视频方案生成失败，可以重试。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
    fireEvent.click(detailsToggle);
    expect(screen.getByRole("list")).toBeTruthy();
    expect(detailsToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "收起失败步骤" }));
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("视频方案生成失败，可以重试。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "正在重试…" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows safe in-progress results without presenting them as a finished script", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          progress_kind: "video_plan",
          status: "running",
          intermediate_results: [
            {
              stage: "creative_direction",
              state: "completed",
              public_projection: {
                selected_id: "direction-a",
                selected_candidate: { angle: "结果先行" },
              },
            },
            {
              stage: "scene_structure",
              state: "completed",
              public_projection: {
                scene_count: 1,
                scenes: [
                  {
                    id: "scene-1",
                    title: "开场",
                    role: "吸引注意",
                    duration_seconds: 5,
                  },
                ],
              },
            },
            {
              stage: "scene_direction",
              scene_id: "scene-1",
              state: "completed",
              public_projection: {
                id: "scene-1",
                title: "开场",
                narration: "先展示核心结果。",
                visual_brief: "快速展示使用前后对比。",
              },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("生成中结果")).toBeTruthy();
    expect(screen.getByText("创意方向")).toBeTruthy();
    expect(screen.getByText("结果先行")).toBeTruthy();
    expect(screen.getAllByText(/开场/).length).toBeGreaterThan(0);
    expect(screen.getByText(/先展示核心结果/)).toBeTruthy();
    expect(screen.queryByText("scene_direction")).toBeNull();
    expect(screen.queryByText(/编导稿已完成/)).toBeNull();
  });

  it("explains what a retry reused and where processing continues", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          progress_kind: "video_plan",
          status: "failed",
          checkpoint_resume: {
            version: "video-generation-checkpoint-resume:v1",
            reused_stages: ["creative_direction", "scene_direction/scene-1"],
            invalidation_boundary: "topic_alignment",
            invalidation_reason: "missing",
            rerun_scene_ids: ["scene-2"],
          },
        })}
      />,
    );

    expect(
      screen.getByText("已复用 2 个已完成阶段，将从整体校对继续。"),
    ).toBeTruthy();
    expect(screen.getByText("将重新处理 1 个分镜。")).toBeTruthy();
    expect(
      screen.queryByText(/topic_alignment|scene_direction|missing/),
    ).toBeNull();
  });

  it("only exposes retry when the server marks a failed job retryable", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          progress_kind: "video_plan",
          status: "failed",
          retryable: false,
          error_message: "内容没有通过质量检查。",
        })}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /重试|重新执行此步骤/ }),
    ).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("names the failed stage and keeps a saved intermediate result actionable", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          progress_kind: "video_plan",
          status: "failed",
          error_message: "模型服务响应超时。",
          progress_events: [
            {
              key: "drafting",
              label: "正在生成编导稿",
              detail: "",
              status: "completed",
              occurred_at: "2026-07-17T06:00:01Z",
            },
            {
              key: "failed",
              label: "内容生成失败",
              detail: "模型服务响应超时。",
              status: "completed",
              occurred_at: "2026-07-17T06:03:01Z",
            },
          ],
          failure_context: {
            stage: "drafting",
            reusable_result: { asset_id: 42 },
            actions: ["retry"],
          },
        })}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("失败阶段：正在生成编导稿")).not.toBeNull();
    expect(screen.getByText("已保留可继续使用的中间结果。")).not.toBeNull();
    expect(screen.getByRole("button", { name: "重试" })).not.toBeNull();
  });

  it("shows completed and failed scenes while keeping network retry explicit", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          progress_kind: "video_plan",
          status: "failed",
          error_message:
            "第 2 镜的素材分析服务暂时不可用，已完成内容会保留，可以直接重试此步骤。",
          scene_progress: [
            {
              scene_id: "scene-1",
              scene_number: 1,
              title: "开场",
              status: "completed",
              detail: "素材已确认。",
              updated_at: "2026-09-21T05:00:00Z",
            },
            {
              scene_id: "scene-2",
              scene_number: 2,
              title: "过程",
              status: "failed",
              detail: "素材分析服务暂时不可用。",
              updated_at: "2026-09-21T05:00:01Z",
            },
          ],
        })}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("第 1 镜 · 开场")).not.toBeNull();
    expect(screen.getByText("第 2 镜 · 过程")).not.toBeNull();
    expect(screen.getByText("素材分析服务暂时不可用。")).not.toBeNull();
    expect(screen.getByRole("button", { name: "重试" })).not.toBeNull();
  });

  it("shows queued and running progress", () => {
    const { rerender } = render(<AssetGenerationJobCard job={job({})} />);
    expect(screen.getAllByText("内容生成已排队").length).toBeGreaterThan(0);

    rerender(
      <AssetGenerationJobCard
        job={job({
          status: "running",
          progress_events: [
            {
              key: "structuring_director_script",
              label: "正在整理编导稿",
              detail: "",
              status: "active",
              occurred_at: "2026-07-17T06:00:01Z",
            },
          ],
          provider_wait: {
            stage: "structuring_director_script",
            status: "first_response_received",
            idle_timeout_seconds: 90,
            safety_timeout_seconds: 900,
            request_sent_at: "2026-07-17T06:00:01Z",
            first_response_at: "2026-07-17T06:00:02Z",
            last_response_at: "2026-07-17T06:00:03Z",
          },
        })}
      />,
    );
    expect(screen.getByText("正在整理编导稿")).not.toBeNull();
    expect(screen.getByText(/模型服务已开始响应/)).not.toBeNull();
    expect(screen.getByText(/最近响应/)).not.toBeNull();
    expect(screen.getByText(/停滞保护剩余/)).not.toBeNull();
    expect(screen.getByText(/安全上限剩余/)).not.toBeNull();
    expect(
      document.querySelector(".shadcn-prototype-agent-run"),
    ).not.toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows real byte progress while staging a long-form source", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          status: "running",
          progress_events: [
            {
              key: "source_staging",
              label: "正在准备原片",
              detail: "正在准备原片（18.2 MB / 27.7 MB，66%）。",
              status: "active",
              occurred_at: "2026-08-05T06:00:01Z",
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByText("正在准备原片（18.2 MB / 27.7 MB，66%）。"),
    ).not.toBeNull();
  });

  it("collapses a completed task and lets the user review its steps", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          status: "completed",
          progress_events: [
            {
              key: "drafting",
              label: "正在生成内容",
              detail: "",
              status: "completed",
              occurred_at: "2026-07-17T06:00:01Z",
            },
            {
              key: "completed",
              label: "内容生成已完成",
              detail: "已保存",
              status: "completed",
              occurred_at: "2026-07-17T06:00:02Z",
            },
          ],
        })}
      />,
    );
    expect(screen.queryByText("已保存")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    expect(screen.getByText("内容生成已完成")).not.toBeNull();
  });

  it("describes a completed director script without claiming the video is ready", () => {
    render(
      <AssetGenerationJobCard
        job={job({
          status: "completed",
          progress_events: [
            {
              key: "structuring_director_script",
              label: "正在整理编导稿",
              detail: "",
              status: "completed",
              occurred_at: "2026-07-17T06:00:01Z",
            },
            {
              key: "completed",
              label: "编导稿已生成",
              detail: "已保存",
              status: "completed",
              occurred_at: "2026-07-17T06:00:02Z",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("视频方案已准备好")).not.toBeNull();
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
    render(
      <AssetGenerationJobCard
        job={job({
          status: "cancelled",
          updated_at: "2026-07-17T06:00:04Z",
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /共 2 步/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    expect(screen.getByText("内容生成已排队")).not.toBeNull();
    expect(screen.getByText("本次生成已停止")).not.toBeNull();
  });

  it("lets the user explicitly restart a stopped generation", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({ status: "cancelled", regenerable: true })}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /内容生成进度/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
  });

  it("renders a controlled timeout and retries the same job", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          error_message:
            "AI generation service failed: The read operation timed out",
        })}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("内容生成超时，本轮没有创建产物，可以直接重试。"),
    ).not.toBeNull();
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
    expect(screen.getByRole("button", { name: "正在重试…" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "正在重试…" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rejectRetry(new Error("retry rejected"));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "重新执行此步骤" }),
      ).toHaveProperty("disabled", false);
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
    expect(
      screen.queryByText(
        /provider_rejected|presenter_events|InvalidSchema|sha256:body-free/,
      ),
    ).toBeNull();
  });

  it("keeps a historical failed job retryable when its saved progress is invalid", () => {
    const onRetry = vi.fn();
    render(
      <AssetGenerationJobCard
        job={job({
          status: "failed",
          progress_events: [
            null,
          ] as unknown as AssetGenerationJobResponse["progress_events"],
        })}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("内容生成失败，本轮没有创建产物，可以直接重试。"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新执行此步骤" }));
    expect(onRetry).toHaveBeenCalledWith("asset-generation-job-1");
  });
});
