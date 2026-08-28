// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error("request failed"), { status });
}

describe("ProductMetricsClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(getAdminProductMetrics).mockReset();
  });

  afterEach(() => cleanup());

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
});
