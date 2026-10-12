import { describe, expect, it } from "vitest";
import { clarityCostLabel, clarityQualityLabel, parseClarityResult, parseClarityReview, parseClarityCandidates, clarityConfirmationValid } from "../lib/video-clarity-presentation";

export const enhancement = {
  version: "video-clarity-result:v1", job_id: "clarity-job", asset_id: 7,
  status: "completed", quality_status: "failed", stage: "done", adopted: false, retryable: false,
  intervals: [{ interval_id: "range-1", scene_id: "scene-1", start_seconds: 1, end_seconds: 3,
    status: "quality_failed", qualified: false, adopted: false, candidate_available: true }],
  processing_cost: { currency: "CNY", incurred_minor: 125, known_incurred_minor: 125, unknown_executions: 0 },
  payment: { status: "unverified", settled_minor: null },
  delivery: { confirmed_at: "2026-10-10T00:00:00Z", target_seconds: 600, elapsed_seconds: 601,
    result_ready_at: "2026-10-10T00:10:01Z", target_met: false }, needs_reconciliation: false,
};

const boundary = { interval_id: "b".repeat(64), scene_id: "shot", start_seconds: 0, end_seconds: 20,
  boundary_source: "actual_cut", boundary_fingerprint: "c".repeat(64) };
const wholeReview = { requested_asset_id: 7, asset_id: 7, version_id: null, source_variant: "original",
  status: "reviewed", coverage_complete: true, profile_current: true, failure: null, scope: "shot_sampled_windows",
  processing_scope: "whole_shot", shot_boundaries: [{ ...boundary }], eligible_intervals: [{ ...boundary }],
  observations: [{ scene_id: "shot", coverage: "complete", boundary_verification: "verified",
    observed_blur: "obvious", blur_scope: "overall", obvious_artifacts: [], actionability: "enhancement",
    evidence: "原生抽样存在整体模糊", uncertainty: [] }] };

it("consumes complete native shots without model-written intra-shot times", () => {
  const value = parseClarityReview(wholeReview);
  expect(value?.shot_boundaries).toEqual([boundary]);
  expect(value?.eligible_intervals).toEqual([boundary]);
  expect(value?.processing_scope).toBe("whole_shot");
});

it.each(["missing", "identity", "boundary", "subset", "duplicate", "foreign"])("rejects unverifiable complete-shot scope: %s", (kind) => {
  const value = structuredClone(wholeReview);
  if (kind === "missing") value.shot_boundaries = [];
  if (kind === "identity") value.shot_boundaries[0].interval_id = "old-range";
  if (kind === "boundary") value.shot_boundaries[0].boundary_source = "confirmed_range";
  if (kind === "subset") value.eligible_intervals[0].end_seconds = 2;
  if (kind === "duplicate") value.shot_boundaries.push({ ...boundary });
  if (kind === "foreign") value.eligible_intervals[0].scene_id = "other";
  expect(parseClarityReview(value)).toBeNull();
});

describe("clarity public presentation", () => {
  it("keeps quality failure separate from successful processing and incurred fees", () => {
    const value = parseClarityResult(enhancement);
    expect(value?.version).toBe("video-clarity-result:v1");
    expect(clarityQualityLabel("failed")).toBe("复检未通过");
    expect(clarityCostLabel(enhancement.processing_cost)).toContain("1.25");
  });
  it("does not turn unknown cost into zero or payment", () => {
    expect(clarityCostLabel({ currency: "CNY", incurred_minor: null, known_incurred_minor: 125, unknown_executions: 1 })).toContain("待核对");
  });
  it.each([-1, NaN, Infinity])("rejects malformed amounts: %s", (amount) => {
    expect(parseClarityResult({ ...enhancement, processing_cost: { ...enhancement.processing_cost, incurred_minor: amount } })).toBeNull();
  });
  it("does not accept an adopted or retryable enhancement result", () => {
    expect(parseClarityResult({ ...enhancement, adopted: true })).toBeNull();
    expect(parseClarityResult({ ...enhancement, retryable: true })).toBeNull();
  });
  it("requires current known risk disclosure and a nonexpired frozen quote", () => {
    const card = { risk_copy_version: "video-clarity-risk:v1", currency: "CNY", estimated_minor: 125, max_minor: 200, expires_at: "2099-01-01T00:00:00Z" };
    expect(clarityConfirmationValid(card)).toBe(true);
    expect(clarityConfirmationValid({ ...card, risk_copy_version: "unknown" })).toBe(false);
    expect(clarityConfirmationValid({ ...card, expires_at: "2000-01-01T00:00:00Z" })).toBe(false);
    expect(clarityConfirmationValid(undefined)).toBe(false);
  });
});

it("rejects invalid reports instead of letting unrelated payloads crash playback", () => {
  const pending = { requested_asset_id: 7, asset_id: 7, version_id: null, source_variant: "original", status: "not_reviewed",
    coverage_complete: false, profile_current: false, failure: null, scope: null, observations: [] };
  expect(parseClarityReview(pending)?.status).toBe("not_reviewed");
  expect(parseClarityReview({ ...pending, observations: undefined })).toBeNull();
  expect(parseClarityReview({ ...pending, observations: [null] })).toBeNull();
  expect(parseClarityReview({ ...pending, status: "reviewed", coverage_complete: true, profile_current: true })).toBeNull();
});


it("preserves server-valid detailed uncertainty without accepting oversized evidence", () => {
  const row = { scene_id: "shot", coverage: "complete", boundary_verification: "verified", observed_blur: "uncertain", blur_scope: "uncertain", obvious_artifacts: [], actionability: "uncertain", evidence: "证据", uncertainty: ["原".repeat(2000)] };
  const value = { ...wholeReview, eligible_intervals: [], observations: [row] };
  expect(parseClarityReview(value)?.observations[0].uncertainty).toEqual(row.uncertainty);
  expect(parseClarityReview({ ...value, observations: [{ ...row, uncertainty: ["原".repeat(2001)] }] })).toBeNull();
});

it("candidate selection requires matching public response identity and complete safe preview fields", () => {
  const media = { preview_url: "http://localhost/owned?token=test", native_sha256: "b".repeat(64), width: 1280, height: 720 };
  const candidate = { candidate_id: "a".repeat(64), file_id: 2, interval_id: "good", scene_id: "scene", start_seconds: 0, end_seconds: 1, review_status: "qualified", adopted: false, comparison: { original: media, candidate: media, preview_independently_reviewed: false } };
  const response = { asset_id: 7, job_id: "job", candidates: [candidate] };
  expect(parseClarityCandidates(response, 7, "job")).toEqual([candidate]);
  expect(parseClarityCandidates({ ...response, asset_id: 8 }, 7, "job")).toBeNull();
  expect(parseClarityCandidates({ ...response, candidates: [{ ...candidate, comparison: { ...candidate.comparison, original: null } }] }, 7, "job")).toBeNull();
  expect(parseClarityCandidates({ ...response, candidates: [{ ...candidate, comparison: { ...candidate.comparison, original: { ...media, preview_url: "javascript:alert(1)" } } }] }, 7, "job")).toBeNull();
  expect(parseClarityCandidates({ ...response, candidates: [{ ...candidate, comparison: null }] }, 7, "job")).toEqual([{ ...candidate, comparison: null }]);
});
