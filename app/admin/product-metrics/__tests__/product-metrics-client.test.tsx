// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAdminProductMetrics } from "@/lib/api";
import ProductMetricsClient from "../product-metrics-client";


vi.mock("@/lib/api", () => ({
  getAdminProductMetrics: vi.fn(),
  apiErrorStatus: (error: unknown) => (
    error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status
      : undefined
  ),
}));

const metrics = {
  window_days: 30 as const,
  generated_at: "2040-01-31T12:00:00Z",
  totals: {
    registered_users: 12,
    workspace_users: 10,
    activated_users: 8,
    editable_video_users: 6,
    modified_video_users: 4,
    exported_video_users: 3,
  },
  funnel: [
    { key: "registered", label: "注册", users: 12 },
    { key: "activated", label: "完成激活", users: 8 },
    { key: "editable_video", label: "获得可编辑视频", users: 6 },
  ],
  rates: {
    activation_rate: 0.6667,
    editable_video_rate: 0.5,
    modified_video_rate: 0.6667,
    exported_video_rate: 0.5,
    saved_asset_scene_rate: 0.75,
    source_evidence_open_rate: 0.5,
    recommendation_select_rate: 0.6,
  },
  durations: {
    time_to_first_editable_video_seconds_median: 540,
    time_to_first_editable_video_seconds_p75: 900,
  },
  daily: [],
};

const videoOutcomes = {
  started_tasks: 3,
  first_playable_tasks: 2,
  first_playable_rate: 2 / 3,
  reviewed_playable_tasks: 1,
  unreviewed_playable_tasks: 1,
  accepted_tasks: 1,
  first_version_accepted_tasks: 0,
  first_version_acceptance_rate: 0,
  accepted_within_two_user_edits_tasks: null,
  user_edit_covered_tasks: 0,
  user_edit_unknown_tasks: 3,
  user_reported_published_tasks: 0,
  first_render_wait_seconds_median: 120,
  user_active_seconds_median: null,
  accepted_cost_usd_median: null,
  accepted_cost_covered_tasks: 0,
  audience_unclassified_tasks: 3,
};

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error("request failed"), { status });
}

describe("ProductMetricsClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(getAdminProductMetrics).mockReset();
  });

  afterEach(() => cleanup());

  it.each([
    [2.61, 0.2, 0.12, "¥2.610000", "$0.200000", "$0.120000"],
    [null, null, null, "未知", "未知", "未知"],
    [0, 0, 0, "¥0.000000", "$0.000000", "$0.000000"],
  ] as const)("shows known fee subtotals separately from full cost: %s", async (cny, usd, allocated, cnyText, usdText, allocatedText) => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue({ ...metrics, video_outcomes: {
      ...videoOutcomes, cost_recorded_tasks: 2, cost_unrecorded_tasks: 1,
      cost_recorded_calls: 5, cost_priced_calls: 4, cost_unknown_price_calls: 1,
      known_estimated_cost_cny_subtotal: cny, known_estimated_cost_usd_subtotal: usd,
      supplier_allocated_cost_usd_subtotal: allocated, cost_allocated_calls: 1,
    } });
    render(<ProductMetricsClient />);
    const fees = await screen.findByLabelText("费用记录覆盖");
    expect(within(fees).getByLabelText("有费用记录任务")).toHaveTextContent("2");
    expect(within(fees).getByLabelText("未记录费用任务")).toHaveTextContent("1");
    expect(within(fees).getByLabelText("金额未知调用")).toHaveTextContent("1");
    expect(within(fees).getByLabelText("人民币已知估算小计")).toHaveTextContent(cnyText);
    expect(within(fees).getByLabelText("美元已知估算小计")).toHaveTextContent(usdText);
    expect(within(fees).getByLabelText("供应商账单分摊小计")).toHaveTextContent(allocatedText);
    expect(within(fees).getByText(/不等于整片实付成本/)).toBeVisible();
    expect(screen.getByLabelText("已采用视频实付成本中位数")).toHaveTextContent("暂无实付数据");
  });

  it("keeps missing fee coverage unknown for older API responses", async () => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue({ ...metrics, video_outcomes: videoOutcomes });
    render(<ProductMetricsClient />);
    const fees = await screen.findByLabelText("费用记录覆盖");
    expect(within(fees).getByLabelText("有费用记录任务")).toHaveTextContent("暂无覆盖数据");
    expect(within(fees).getByLabelText("人民币已知估算小计")).toHaveTextContent("未知");
  });

  it("asks the visitor to sign in when no stored token exists", async () => {
    render(<ProductMetricsClient />);

    expect(await screen.findByText("请先登录")).toBeVisible();
    expect(getAdminProductMetrics).not.toHaveBeenCalled();
  });

  it("never renders metrics when the backend returns 403", async () => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email: "member@example.com", token: "member-token" }),
    );
    vi.mocked(getAdminProductMetrics).mockRejectedValue(apiError(403));

    render(<ProductMetricsClient />);

    expect(await screen.findByText("无权访问此页面")).toBeVisible();
    expect(screen.queryByLabelText("产品激活漏斗")).not.toBeInTheDocument();
  });

  it("clears an expired local session after a 401", async () => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email: "admin@example.com", token: "expired-token" }),
    );
    vi.mocked(getAdminProductMetrics).mockRejectedValue(apiError(401));

    render(<ProductMetricsClient />);

    expect(await screen.findByText("登录已失效，请重新登录")).toBeVisible();
    expect(window.localStorage.getItem("multimix_local_user")).toBeNull();
  });

  it("renders the admin metrics returned by the backend", async () => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email: "admin@example.com", token: "admin-token" }),
    );
    vi.mocked(getAdminProductMetrics).mockResolvedValue(metrics);

    render(<ProductMetricsClient />);

    expect(await screen.findByRole("heading", { name: "产品指标" })).toBeVisible();
    expect(screen.getByLabelText("产品激活漏斗")).toBeVisible();
    expect(screen.getByText("用户素材分镜占比")).toBeVisible();
    expect(screen.getByText("75%")) .toBeVisible();
    expect(screen.getByText("最近 30 天注册的非管理员用户 cohort")).toBeVisible();
    expect(getAdminProductMetrics).toHaveBeenCalledWith("admin-token", 30);
  });

  it("can change the metrics window without exposing admin state in the client", async () => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email: "admin@example.com", token: "admin-token" }),
    );
    vi.mocked(getAdminProductMetrics).mockResolvedValue(metrics);

    render(<ProductMetricsClient />);
    await screen.findByRole("heading", { name: "产品指标" });
    screen.getByRole("button", { name: "最近 7 天" }).click();

    await waitFor(() => expect(getAdminProductMetrics).toHaveBeenLastCalledWith("admin-token", 7));
  });

  it("distinguishes counted video outcomes from metrics that are not collected", async () => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue({
      ...metrics,
      video_outcomes: videoOutcomes,
    });
    render(<ProductMetricsClient />);
    const results = await screen.findByLabelText("视频结果指标");
    expect(within(results).getByLabelText("已启动任务")).toHaveTextContent("3");
    expect(within(results).getByLabelText("已有可播放结果")).toHaveTextContent("2");
    expect(within(results).getByLabelText("首版接受率")).toHaveTextContent("0%");
    expect(within(results).getByLabelText("用户自报已发布")).toHaveTextContent("0");
    expect(within(results).getByLabelText("可播放但未表态")).toHaveTextContent("1");
    expect(within(results).getByLabelText("两轮内采用")).toHaveTextContent("尚未采集");
    expect(within(results).getByLabelText("前台主动操作时间中位数")).toHaveTextContent("尚未采集");
    expect(within(results).getByLabelText("已采用视频实付成本中位数")).toHaveTextContent("暂无实付数据");
    expect(within(results).getByLabelText("后台制作等待中位数")).toHaveTextContent("2 分钟");
    expect(within(results).getByText(/接受率以已启动任务为分母/)).toBeVisible();
    expect(within(results).getByText(/下载不等于用户接受或发布/)).toBeVisible();
    expect(within(results).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("shows a legacy response as unavailable rather than zero video outcomes", async () => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue(metrics);
    render(<ProductMetricsClient />);
    expect(await screen.findByText("视频结果指标暂不可用")).toBeVisible();
    expect(screen.queryByLabelText("已启动任务")).not.toBeInTheDocument();
    expect(screen.getByLabelText("产品激活漏斗")).toBeVisible();
  });

  it("keeps measured zero distinct from missing time and cost coverage", async () => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue({
      ...metrics,
      video_outcomes: {
        ...videoOutcomes,
        accepted_within_two_user_edits_tasks: 0,
        user_active_seconds_median: 0,
        accepted_cost_usd_median: 0,
        accepted_cost_covered_tasks: 1,
      },
    });
    render(<ProductMetricsClient />);
    const results = await screen.findByLabelText("视频结果指标");
    expect(within(results).getByLabelText("两轮内采用")).toHaveTextContent("0");
    expect(within(results).getByLabelText("前台主动操作时间中位数")).toHaveTextContent("0 秒");
    expect(within(results).getByLabelText("已采用视频实付成本中位数")).toHaveTextContent("$0.00");
    expect(within(results).getByLabelText("实付成本覆盖任务")).toHaveTextContent("1");
    expect(within(results).queryByText("尚未采集")).not.toBeInTheDocument();
  });

  it("shows observed interactions separately from uncollected creation time", async () => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue({ ...metrics, video_outcomes: {
      ...videoOutcomes, observed_video_interaction_seconds_median: 20,
      observed_video_interaction_projects: 1,
      observed_director_interaction_seconds_median: 0,
      observed_director_interaction_scripts: 1,
      observed_creation_interaction_seconds_median: 25,
      observed_creation_interaction_tasks: 1,
    } });
    render(<ProductMetricsClient />);
    const results = await screen.findByLabelText("视频结果指标");
    expect(within(results).getByLabelText("已观察工程交互时间中位数")).toHaveTextContent("20 秒");
    expect(within(results).getByLabelText("交互时间覆盖工程")).toHaveTextContent("1");
    expect(within(results).getByLabelText("已观察编导交互时间中位数")).toHaveTextContent("0 秒");
    expect(within(results).getByLabelText("交互时间覆盖编导稿")).toHaveTextContent("1");
    expect(within(results).getByLabelText("已观察创作交互时间中位数")).toHaveTextContent("25 秒");
    expect(within(results).getByLabelText("创作交互覆盖任务")).toHaveTextContent("1");
    expect(within(results).getByLabelText("前台主动操作时间中位数")).toHaveTextContent("尚未采集");
    expect(within(results).getByText(/不等于完整创作投入/)).toBeVisible();
  });

  it("shows counted adoption only alongside verified edit coverage", async () => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email: "admin@example.com", token: "admin-token" }));
    vi.mocked(getAdminProductMetrics).mockResolvedValue({ ...metrics, video_outcomes: {
      ...videoOutcomes, accepted_within_two_user_edits_tasks: 1,
      user_edit_covered_tasks: 2, user_edit_unknown_tasks: 1,
    } });
    render(<ProductMetricsClient />);
    const results = await screen.findByLabelText("视频结果指标");
    expect(within(results).getByLabelText("两轮内采用")).toHaveTextContent("1");
    expect(within(results).getByLabelText("修改次数可核验任务")).toHaveTextContent("2");
    expect(within(results).getByLabelText("修改次数未知任务")).toHaveTextContent("1");
    expect(within(results).getByText(/首个可播放视频之后/)).toBeVisible();
    expect(within(results).getByText(/仅统计修改链完整的任务/)).toBeVisible();
  });
});
