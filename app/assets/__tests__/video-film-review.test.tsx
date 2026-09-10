// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import VideoFilmReviewPanel from "../components/video-film-review-panel";
import { getFilmReviews, requestFilmReviewRepair, startFilmReview } from "../../../lib/video-project-client";

vi.mock("../../../lib/video-project-client", () => ({
  getFilmReviews: vi.fn(), startFilmReview: vi.fn(), requestFilmReviewRepair: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const finding = { id: "issue-1", scene_id: "scene-1", category: "visual_alignment", severity: "P2" as const,
  reason: "画面没有展示萃取过程", suggestion: "换成萃取过程画面", start_seconds: 1, end_seconds: 4,
  evidence_ids: ["visual:scene-1"] };
const state = (current = true) => ({ can_review: true, unavailable_reason: null, script_review: null,
  reviews: [{ id: "review-1", status: "completed", is_current: current, error: null, created_at: null,
    requested_repairs: [], report: { mode: "film" as const, status: "partial" as const, summary: "建议调整开头画面",
      coverage: { visual: "sampled", speech: "unavailable" }, notes: ["每镜三个时间点抽样"],
      findings: [finding], follow_up: [] } }] });

it("shows coverage and requires a user repair choice before recording revision intent", async () => {
  vi.mocked(getFilmReviews).mockResolvedValue(state());
  vi.mocked(requestFilmReviewRepair).mockResolvedValue();
  const onRevise = vi.fn();
  render(<VideoFilmReviewPanel token="test" assetId={12} revisionKey="v1" onLocate={vi.fn()} onRevise={onRevise} />);
  await screen.findByText("画面没有展示萃取过程");
  expect(screen.getByText(/复转写未完成/)).toBeVisible();
  expect(requestFilmReviewRepair).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看修订选项" }));
  expect(requestFilmReviewRepair).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "更换画面" }));
  await waitFor(() => expect(onRevise).toHaveBeenCalledWith(finding, "material"));
  expect(requestFilmReviewRepair).toHaveBeenCalledWith({ token: "test", projectAssetId: 12,
    reviewId: "review-1", issueId: "issue-1" });
});

it("marks stale reports and disables revision based on an old version", async () => {
  vi.mocked(getFilmReviews).mockResolvedValue(state(false));
  render(<VideoFilmReviewPanel token="test" assetId={12} revisionKey="v2" onLocate={vi.fn()} onRevise={vi.fn()} />);
  await screen.findByText(/报告已过期/);
  expect(screen.getByRole("button", { name: "查看修订选项" })).toBeDisabled();
});

it("shows revalidation separately from newly found issues", async () => {
  const payload = state();
  payload.reviews[0].report.findings = [];
  const report = { ...payload.reviews[0].report, follow_up: [{ issue_id: "issue-1", issue: finding,
    status: "resolved" as const, evidence_ids: ["visual:scene-1"] }] };
  vi.mocked(getFilmReviews).mockResolvedValue({ ...payload, reviews: [{ ...payload.reviews[0], report }] });
  render(<VideoFilmReviewPanel token="test" assetId={12} revisionKey="v3" onLocate={vi.fn()} onRevise={vi.fn()} />);
  expect(await screen.findByText(/本版复验已解决/)).toBeVisible();
});

it("supplements a partial report and disables repeats once all checks are covered", async () => {
  const initial = state();
  const partialJob = { ...initial.reviews[0], can_retry: true, missing_checks: ["speech"] };
  const completedJob = { ...partialJob, can_retry: false, missing_checks: [],
    report: { ...partialJob.report, coverage: {
      visual: "sampled", speech: "transcribed", audio: "decode_and_boundaries",
    } } };
  vi.mocked(getFilmReviews).mockResolvedValueOnce({ ...initial, reviews: [partialJob] })
    .mockResolvedValue({ ...initial, reviews: [completedJob] });
  vi.mocked(startFilmReview).mockResolvedValue({ ...partialJob, status: "queued" });
  render(<VideoFilmReviewPanel token="test" assetId={12} revisionKey="same-film"
    onLocate={vi.fn()} onRevise={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "补验未完成检查" }));
  await waitFor(() => expect(startFilmReview).toHaveBeenCalledWith({ token: "test", projectAssetId: 12 }));
  expect(await screen.findByRole("button", { name: "当前成片已审阅" })).toBeDisabled();
  expect(screen.getByText(/已复转写成片/)).toBeVisible();
});

it("does not offer another check while the current supplement is running", async () => {
  const payload = state();
  vi.mocked(getFilmReviews).mockResolvedValue({ ...payload, reviews: [
    { ...payload.reviews[0], status: "running", can_retry: false, missing_checks: ["speech"] },
  ] });
  render(<VideoFilmReviewPanel token="test" assetId={12} revisionKey="same-film"
    onLocate={vi.fn()} onRevise={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "正在审阅…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "查看修订选项" })).toBeDisabled();
});
