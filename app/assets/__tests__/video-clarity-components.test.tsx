// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ClarityProcessingNotice from "../components/clarity-processing-notice";
import VideoClarityReview from "../components/video-clarity-review";
import ConfirmCard from "../components/confirm-card";
import VideoClarityComparison from "../components/video-clarity-comparison";
import type { ClarityEnhancementResult } from "../lib/video-clarity-types";
import { getVideoClarityCandidates, getVideoClarityReview } from "../../../lib/api";
import { CLARITY_RISK_COPY } from "../lib/video-clarity-presentation";

vi.mock("../../../lib/api", () => ({ getVideoClarityCandidates: vi.fn(), getVideoClarityReview: vi.fn(), apiErrorStatus: (error: { status?: number }) => error?.status }));
vi.mock("../components/video-preview-player", async () => {
  const { forwardRef } = await import("react");
  return { default: forwardRef<HTMLVideoElement, { src: string; label: string; muted: boolean; onError: () => void }>(
    function TestPlayer(props, ref) { return <video ref={ref} src={props.src} aria-label={props.label} muted={props.muted} onError={props.onError} />; }) };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined); });

it("shows the complete long shot and keeps processing behind conversation confirmation", async () => {
  const boundary = { interval_id: "b".repeat(64), scene_id: "shot", start_seconds: 0, end_seconds: 20,
    boundary_source: "actual_cut" as const, boundary_fingerprint: "c".repeat(64) };
  vi.mocked(getVideoClarityReview).mockResolvedValue({ requested_asset_id: 7, asset_id: 7, version_id: null,
    source_variant: "original", status: "reviewed", coverage_complete: true, profile_current: true,
    scope: "shot_sampled_windows", processing_scope: "whole_shot", failure: null,
    shot_boundaries: [boundary], eligible_intervals: [boundary], observations: [{ scene_id: "shot",
      coverage: "complete", boundary_verification: "verified", observed_blur: "obvious", blur_scope: "overall",
      obvious_artifacts: ["mosaic"], actionability: "enhancement", evidence: "整体模糊", uncertainty: [] }] });
  render(<VideoClarityReview assetId={7} />);
  expect(await screen.findByText(/完整分镜：0.*20/)).toBeVisible();
  expect(screen.getByText(/可尝试增强此完整分镜/)).toBeVisible();
  expect(screen.queryByText(/问题范围/)).toBeNull();
  expect(screen.getByText(/收费增强暂未开放/)).toBeVisible();
  expect(getVideoClarityCandidates).not.toHaveBeenCalled();
});

function result(): ClarityEnhancementResult {
  return { version: "video-clarity-result:v1", job_id: "test-job", asset_id: 7, status: "completed", quality_status: "failed",
    stage: "done", adopted: false, retryable: false, needs_reconciliation: false,
    intervals: [{ interval_id: "bad", scene_id: "scene-bad", start_seconds: 1, end_seconds: 3, status: "quality_failed", qualified: false, adopted: false, candidate_available: true }],
    processing_cost: { currency: "CNY", incurred_minor: 125, known_incurred_minor: 125, unknown_executions: 0 },
    payment: { status: "unverified", settled_minor: null },
    delivery: { confirmed_at: "2026-10-10T00:00:00Z", target_seconds: 600, elapsed_seconds: 601, result_ready_at: "2026-10-10T00:10:01Z", target_met: false } };
}

it("quality failure still shows incurred fees without a paid or adopted claim", () => {
  render(<ClarityProcessingNotice result={result()} onPrepareAdoption={vi.fn()} />);
  expect(screen.getByText(/已发生处理费：CNY 1.25/)).toBeVisible();
  expect(screen.getByText("复检未通过 · 尚未采用")).toBeVisible();
  expect(screen.getByText(/未核验收款/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "准备采用选中完整分镜" })).toBeNull();
  expect(getVideoClarityCandidates).not.toHaveBeenCalled();
});

it("partial comparison only selects qualified intervals and requests the existing conversation confirmation", async () => {
  const value = result(), id = "a".repeat(64), send = vi.fn();
  value.quality_status = "partial";
  value.intervals.push({ interval_id: "good", scene_id: "scene-good", start_seconds: 4, end_seconds: 5, status: "qualified", qualified: true, adopted: false, candidate_available: true, candidate_id: id });
  const media = { preview_url: "http://localhost/owned?token=test", native_sha256: "b".repeat(64), width: 1280, height: 720 };
  vi.mocked(getVideoClarityCandidates).mockResolvedValue({ asset_id: 7, job_id: "test-job", candidates: [{ candidate_id: id, file_id: 2, interval_id: "good", scene_id: "scene-good", start_seconds: 4, end_seconds: 5, review_status: "qualified", adopted: false,
    comparison: { original: media, candidate: media, preview_independently_reviewed: false } }] });
  const { rerender } = render(<ClarityProcessingNotice result={value} onPrepareAdoption={send} />);
  fireEvent.click(await screen.findByLabelText("选择 scene-good 的合格完整分镜"));
  rerender(<ClarityProcessingNotice result={{ ...value, delivery: { ...value.delivery, elapsed_seconds: 610 } }} onPrepareAdoption={send} />);
  expect(screen.getByLabelText("选择 scene-good 的合格完整分镜")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "准备采用选中完整分镜" }));
  expect(send).toHaveBeenCalledWith(expect.stringContaining("scene-good"));
  expect(send.mock.calls[0][0]).not.toContain("scene-bad");
  expect(screen.getByText(/未经独立画质复检/)).toBeVisible();
  expect(getVideoClarityCandidates).toHaveBeenCalledTimes(1);
});

it("risk disclosure is inside the existing confirmation card and unknown risk disables confirmation", () => {
  const onConfirm = vi.fn();
  const plan = { kind: "agent_action_confirmation" as const, title: "确认画质增强", status: "pending" as const, fields: [], confirmationId: "same-agent-confirm",
    clarityConfirmation: { risk_copy_version: "unknown", currency: "CNY", estimated_minor: 125, max_minor: 200, expires_at: "2099-01-01T00:00:00Z" } };
  const { rerender } = render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);
  expect(screen.getByText(CLARITY_RISK_COPY)).toBeVisible();
  expect(screen.getByRole("button", { name: /确认/ })).toBeDisabled();
  rerender(<ConfirmCard plan={{ ...plan, clarityConfirmation: { ...plan.clarityConfirmation, risk_copy_version: "video-clarity-risk:v1" } }} onConfirm={onConfirm} />);
  expect(screen.getByRole("button", { name: /确认/ })).toBeEnabled();
});

it("review only reads the public report, describes insufficient evidence and keeps enhancement closed", async () => {
  vi.mocked(getVideoClarityReview).mockResolvedValue({ requested_asset_id: 7, asset_id: 7, version_id: 1, source_variant: "original", status: "insufficient", coverage_complete: false, profile_current: true, scope: "shot_sampled_windows", processing_scope: "whole_shot", shot_boundaries: [], eligible_intervals: [], failure: null, observations: [] });
  render(<VideoClarityReview assetId={7} token="local-user" />);
  await waitFor(() => expect(screen.getByText("证据不足")).toBeVisible());
  expect(screen.getByText(/收费增强暂未开放/)).toBeVisible();
  expect(getVideoClarityReview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "刷新审查报告" }));
  await waitFor(() => expect(getVideoClarityReview).toHaveBeenCalledTimes(2));
});

it("unsupported duration explains the review limit while keeping the source", async () => {
  vi.mocked(getVideoClarityReview).mockResolvedValue({ requested_asset_id: 7, asset_id: 7, version_id: null,
    source_variant: "original", status: "insufficient", coverage_complete: false, profile_current: false,
    scope: null, processing_scope: null, shot_boundaries: [], eligible_intervals: [], failure: "input_duration_unsupported", observations: [] });
  render(<VideoClarityReview assetId={7} />);
  expect(await screen.findByText(/首版画质审查最长3分钟/)).toBeVisible();
  expect(screen.getByText(/未开始专项画质审查，原视频已保留/)).toBeVisible();
  expect(getVideoClarityReview).toHaveBeenCalledTimes(1);
  expect(getVideoClarityCandidates).not.toHaveBeenCalled();
});

it("confirmation expires while the card stays open", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
    const onConfirm = vi.fn();
    render(<ConfirmCard plan={{ kind: "agent_action_confirmation", title: "确认画质增强", status: "pending", fields: [],
      clarityConfirmation: { risk_copy_version: "video-clarity-risk:v1", currency: "CNY", estimated_minor: 125, max_minor: 200, expires_at: "2026-10-10T00:00:01Z" } }} onConfirm={onConfirm} />);
    expect(screen.getByRole("button", { name: /确认/ })).toBeEnabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: /确认/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /确认/ }));
    expect(onConfirm).not.toHaveBeenCalled();
  } finally { cleanup(); vi.useRealTimers(); }
});

it("source conflicts are distinct from transport errors and cannot claim review success", async () => {
  vi.mocked(getVideoClarityReview).mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
  render(<VideoClarityReview assetId={7} />);
  expect(await screen.findByText(/当前视频尚未就绪或来源已变化/)).toBeVisible();
  expect(screen.queryByText("分镜抽样审查完成")).toBeNull();
});

it("comparison corrects playback drift and seeking in both directions with one audible player", () => {
  const media = { preview_url: "http://localhost/native-bound-preview", native_sha256: "b".repeat(64), width: 1280, height: 720 };
  render(<VideoClarityComparison candidate={{ candidate_id: "a".repeat(64), file_id: 2, interval_id: "good", scene_id: "scene-good",
    start_seconds: 4, end_seconds: 5, review_status: "qualified", adopted: false,
    comparison: { original: media, candidate: media, preview_independently_reviewed: false } }} />);
  const original = screen.getByLabelText("原版完整分镜播放器") as HTMLVideoElement;
  const candidate = screen.getByLabelText("增强候选播放器") as HTMLVideoElement;
  expect(original.muted).toBe(false); expect(candidate.muted).toBe(true);
  original.currentTime = .7;
  fireEvent.timeUpdate(original);
  expect(candidate.currentTime).toBe(.7);
  candidate.currentTime = .2;
  fireEvent.seeking(candidate);
  expect(original.currentTime).toBe(.2);
});
