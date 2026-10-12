// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import VideoClarityReview from "../components/video-clarity-review";
import ConfirmCard from "../components/confirm-card";
import { getVideoClarityReview } from "../../../lib/api";
import type { AssetMessagePlan } from "../lib/asset-workspace-types";

vi.mock("../../../lib/api", () => ({
  getVideoClarityReview: vi.fn(async () => ({ requested_asset_id: 7 })),
  apiErrorStatus: () => undefined,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("does not mount a review panel or read reports while the feature is suspended", async () => {
  render(<VideoClarityReview assetId={7} token="test-only" />);
  await act(async () => { await Promise.resolve(); });
  expect(getVideoClarityReview).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "视频清晰度审查" })).toBeNull();
  expect(screen.queryByRole("button", { name: "刷新审查报告" })).toBeNull();
});

it.each([true, false])("blocks old pending enhancement cards with explicit metadata=%s", (metadata) => {
  const onConfirm = vi.fn(), onAdjust = vi.fn();
  const plan: AssetMessagePlan = {
    kind: "agent_action_confirmation", title: "确认画质增强", status: "pending", fields: [],
    confirmationId: "saved-confirmation",
    ...(metadata ? { clarityConfirmation: {
      risk_copy_version: "video-clarity-risk:v1", currency: "CNY", estimated_minor: 125,
      max_minor: 200, expires_at: "2099-01-01T00:00:00Z",
    } } : {}),
  };
  render(<ConfirmCard plan={plan} onConfirm={onConfirm} onAdjust={onAdjust} />);
  expect(screen.getByText(/清晰度审查与增强暂未开放/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /确认|调整/ })).toBeNull();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onAdjust).not.toHaveBeenCalled();
});

it("keeps ordinary confirmation available", () => {
  const plan: AssetMessagePlan = { kind: "agent_action_confirmation", title: "确认字幕修改",
    status: "pending", fields: [], confirmationId: "subtitle-confirmation" };
  render(<ConfirmCard plan={plan} onConfirm={vi.fn()} />);
  expect(screen.getByRole("button", { name: /确认/ })).toBeEnabled();
  expect(screen.queryByText(/清晰度审查与增强暂未开放/)).toBeNull();
});
