import type { ClarityConfirmation, ClarityCost, ClarityResult, ClarityReview, ClarityShot, ClarityCandidate, ClarityComparisonMedia } from "./video-clarity-types";

export const CLARITY_RISK_COPY = "增强不保证每次都能改善；已发生的处理费用仍会收取，包括复检不合格的情况。";
export const CLARITY_RESEARCH_RISK_COPY = "本次是研发实验，不保证改善。处理失败或复检不合格仍可能产生项目研发支出；不向测试用户收费。保留原片，合格候选需另行确认采用。";
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const amount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => amount(v) && v > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 128 && v.every(x => typeof x === "string" && x.length <= 200);
const explanation = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every(x => typeof x === "string" && x.length > 0 && x.length <= 2000);
const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const statuses = ["queued", "running", "blocked", "completed", "failed", "canceled"];

function wholeShots(value: unknown): ClarityShot[] | null {
  if (!Array.isArray(value) || value.length > 128) return null;
  const rows: ClarityShot[] = [], ids = new Set<string>(), scenes = new Set<string>();
  for (const row of value) {
    if (!record(row) || !sha(row.interval_id) || !sha(row.boundary_fingerprint)
      || typeof row.scene_id !== "string" || !row.scene_id.length || row.scene_id.length > 200
      || !["actual_cut", "project_mapping_verified"].includes(String(row.boundary_source))
      || !finite(row.start_seconds) || !finite(row.end_seconds)
      || row.end_seconds <= row.start_seconds || row.end_seconds > 180
      || ids.has(row.interval_id as string) || scenes.has(row.scene_id)) return null;
    ids.add(row.interval_id as string); scenes.add(row.scene_id);
    rows.push({ interval_id: row.interval_id as string, scene_id: row.scene_id,
      start_seconds: row.start_seconds, end_seconds: row.end_seconds,
      boundary_source: row.boundary_source as ClarityShot["boundary_source"], boundary_fingerprint: row.boundary_fingerprint as string });
  }
  return rows;
}

export function parseClarityReview(value: unknown): ClarityReview | null {
  if (!record(value) || !positive(value.requested_asset_id) || !positive(value.asset_id)
    || !(value.version_id === null || positive(value.version_id))
    || !["original", "brand_showcase"].includes(String(value.source_variant))
    || !["not_reviewed", "queued", "running", "reviewed", "insufficient", "unavailable"].includes(String(value.status))
    || typeof value.coverage_complete !== "boolean" || typeof value.profile_current !== "boolean"
    || !(value.failure === null || typeof value.failure === "string")
    || !(value.scope === null || value.scope === "shot_sampled_windows")
    || !Array.isArray(value.observations) || value.observations.length > 1024) return null;
  const processingScope = value.processing_scope ?? null;
  if (processingScope !== null && processingScope !== "whole_shot") return null;
  const boundaries = wholeShots(value.shot_boundaries ?? []), eligible = wholeShots(value.eligible_intervals ?? []);
  if (!boundaries || !eligible || eligible.some(shot => !boundaries.some(parent =>
    parent.interval_id === shot.interval_id && parent.scene_id === shot.scene_id
    && parent.start_seconds === shot.start_seconds && parent.end_seconds === shot.end_seconds
    && parent.boundary_source === shot.boundary_source && parent.boundary_fingerprint === shot.boundary_fingerprint))) return null;
  const observations = [];
  for (const row of value.observations) {
    if (!record(row) || typeof row.scene_id !== "string" || row.scene_id.length > 200
      || !["complete", "insufficient"].includes(String(row.coverage))
      || !["verified", "uncertain"].includes(String(row.boundary_verification))
      || !["none", "obvious", "uncertain"].includes(String(row.observed_blur))
      || !["overall", "subject", "background", "mixed", "none", "uncertain"].includes(String(row.blur_scope))
      || !strings(row.obvious_artifacts) || !explanation(row.uncertainty)
      || !["enhancement", "original_generation_fix", "none", "uncertain"].includes(String(row.actionability))
      || typeof row.evidence !== "string" || !row.evidence.length || row.evidence.length > 2000
      || row.affected_windows !== undefined) return null;
    observations.push({ scene_id: row.scene_id, coverage: row.coverage, boundary_verification: row.boundary_verification,
      observed_blur: row.observed_blur, blur_scope: row.blur_scope, obvious_artifacts: row.obvious_artifacts,
      actionability: row.actionability, evidence: row.evidence, uncertainty: row.uncertainty });
  }
  if (value.status === "reviewed" && (!value.coverage_complete || !value.profile_current
    || value.scope !== "shot_sampled_windows" || processingScope !== "whole_shot" || !boundaries.length || !observations.length
    || observations.some(row => row.coverage !== "complete" || row.boundary_verification !== "verified"
      || !boundaries.some(shot => shot.scene_id === row.scene_id)))) return null;
  return { requested_asset_id: value.requested_asset_id, asset_id: value.asset_id, version_id: value.version_id,
    source_variant: value.source_variant, status: value.status, coverage_complete: value.coverage_complete,
    profile_current: value.profile_current, failure: value.failure, scope: value.scope,
    processing_scope: processingScope, shot_boundaries: boundaries, eligible_intervals: eligible, observations } as ClarityReview;
}

function comparisonMedia(value: unknown): ClarityComparisonMedia | null {
  if (!record(value) || !sha(value.native_sha256) || !positive(value.width) || value.width > 16384
    || !positive(value.height) || value.height > 16384 || typeof value.preview_url !== "string" || value.preview_url.length > 8192) return null;
  try { if (!["https:", "http:"].includes(new URL(value.preview_url).protocol)) return null; } catch { return null; }
  return { preview_url: value.preview_url, native_sha256: value.native_sha256 as string, width: value.width, height: value.height };
}

export function parseClarityCandidates(value: unknown, assetId: number, jobId: string): ClarityCandidate[] | null {
  if (!record(value) || value.asset_id !== assetId || value.job_id !== jobId
    || !Array.isArray(value.candidates) || value.candidates.length > 128) return null;
  const rows: ClarityCandidate[] = [], ids = new Set<string>();
  for (const row of value.candidates) {
    if (!record(row) || typeof row.candidate_id !== "string" || !sha(row.candidate_id) || ids.has(row.candidate_id)
      || !positive(row.file_id) || typeof row.interval_id !== "string" || !row.interval_id.length || row.interval_id.length > 200
      || typeof row.scene_id !== "string" || !row.scene_id.length || row.scene_id.length > 200
      || !finite(row.start_seconds) || !finite(row.end_seconds) || row.end_seconds <= row.start_seconds || row.end_seconds > 180
      || !["qualified", "quality_failed", "insufficient", "pending"].includes(String(row.review_status)) || typeof row.adopted !== "boolean") return null;
    let comparison: ClarityCandidate["comparison"] = null;
    if (row.comparison !== null) {
      if (!record(row.comparison) || row.comparison.preview_independently_reviewed !== false) return null;
      const original = comparisonMedia(row.comparison.original), candidate = comparisonMedia(row.comparison.candidate);
      if (!original || !candidate) return null;
      comparison = { original, candidate, preview_independently_reviewed: false };
    }
    ids.add(row.candidate_id);
    rows.push({ candidate_id: row.candidate_id, file_id: row.file_id, interval_id: row.interval_id, scene_id: row.scene_id,
      start_seconds: row.start_seconds, end_seconds: row.end_seconds, review_status: row.review_status as string, adopted: row.adopted, comparison });
  }
  return rows;
}

export function parseClarityResult(value: unknown): ClarityResult | null {
  if (!record(value) || typeof value.job_id !== "string" || !positive(value.asset_id)
    || !statuses.includes(String(value.status)) || typeof value.stage !== "string" || value.retryable !== false) return null;
  if (value.version === "video-clarity-result:v1") {
    const cost = value.processing_cost, payment = value.payment, delivery = value.delivery;
    if (value.funding_purpose !== undefined && !["commercial", "research"].includes(String(value.funding_purpose))) return null;
    if (value.funding_purpose === "research" && (!record(payment) || payment.status !== "unverified" || payment.settled_minor !== null)) return null;
    const modelCost = value.research_model_cost;
    if (modelCost !== undefined && (value.funding_purpose !== "research" || !record(modelCost)
      || modelCost.currency !== "CNY" || !amount(modelCost.known_incurred_minor) || !amount(modelCost.unknown_executions)
      || (modelCost.unknown_executions > 0 ? modelCost.incurred_minor !== null : modelCost.incurred_minor !== modelCost.known_incurred_minor))) return null;
    if (value.adopted !== false || !["pending", "qualified", "partial", "failed", "unknown"].includes(String(value.quality_status))
      || !record(cost) || !["CNY", "USD", "EUR"].includes(String(cost.currency))
      || !(cost.incurred_minor === null || amount(cost.incurred_minor))
      || !amount(cost.known_incurred_minor) || !amount(cost.unknown_executions)
      || !record(payment) || !["unverified", "receipts_available"].includes(String(payment.status))
      || !(payment.settled_minor === null || amount(payment.settled_minor))
      || payment.status === "unverified" && payment.settled_minor !== null
      || !record(delivery) || delivery.target_seconds !== 600 || !finite(delivery.elapsed_seconds)
      || typeof delivery.confirmed_at !== "string" || !Number.isFinite(Date.parse(delivery.confirmed_at))
      || !(delivery.result_ready_at === null || typeof delivery.result_ready_at === "string" && Number.isFinite(Date.parse(delivery.result_ready_at)))
      || !(delivery.target_met === null || typeof delivery.target_met === "boolean")
      || typeof value.needs_reconciliation !== "boolean"
      || !Array.isArray(value.intervals) || !value.intervals.length || value.intervals.length > 128) return null;
    const intervals = [];
    for (const row of value.intervals) {
      if (!record(row) || typeof row.interval_id !== "string" || typeof row.scene_id !== "string"
        || !finite(row.start_seconds) || !finite(row.end_seconds) || row.end_seconds <= row.start_seconds
        || !["pending", "submitting", "submission_unknown", "polling", "candidate_saved", "postreview", "qualified", "quality_failed", "insufficient", "processing_failed", "rejected", "unexecuted", "unknown"].includes(String(row.status))
        || row.qualified !== (row.status === "qualified") || row.adopted !== false || typeof row.candidate_available !== "boolean"
        || row.candidate_id != null && !sha(row.candidate_id)) return null;
      intervals.push({ interval_id: row.interval_id, scene_id: row.scene_id, start_seconds: row.start_seconds,
        end_seconds: row.end_seconds, status: row.status, qualified: row.qualified, adopted: false,
        candidate_available: row.candidate_available, candidate_id: row.candidate_id ?? null,
        candidate_file_id: positive(row.candidate_file_id) ? row.candidate_file_id : null,
        processing_fee_minor: row.status === "unexecuted" && row.processing_fee_minor === 0 ? 0 : null,
        review: record(row.review) ? { improvement: row.review.improvement, fidelity: row.review.fidelity,
          temporal: row.review.temporal, obvious_artifacts: strings(row.review.obvious_artifacts) ? row.review.obvious_artifacts : null,
          uncertainty: explanation(row.review.uncertainty) ? row.review.uncertainty : null } : null });
    }
    return { version: value.version, job_id: value.job_id, asset_id: value.asset_id, status: value.status,
      quality_status: value.quality_status, stage: value.stage, adopted: false, retryable: false, intervals,
      ...(value.funding_purpose === "research" ? {funding_purpose:"research" as const} : {}),
      ...(record(modelCost) ? {research_model_cost: {currency: modelCost.currency, incurred_minor: modelCost.incurred_minor,
        known_incurred_minor: modelCost.known_incurred_minor, unknown_executions: modelCost.unknown_executions}} : {}),
      processing_cost: { currency: cost.currency, incurred_minor: cost.incurred_minor, known_incurred_minor: cost.known_incurred_minor, unknown_executions: cost.unknown_executions },
      payment: { status: payment.status, settled_minor: payment.settled_minor },
      delivery: { confirmed_at: delivery.confirmed_at, target_seconds: 600, elapsed_seconds: delivery.elapsed_seconds, result_ready_at: delivery.result_ready_at, target_met: delivery.target_met },
      needs_reconciliation: value.needs_reconciliation } as ClarityResult;
  }
  if (value.version === "video-clarity-adoption-result:v1" && positive(value.target_asset_id)
    && ["source_usage", "scene_primary", "film_delivery"].includes(String(value.mode))
    && ["adopted", "original", "other", "pending"].includes(String(value.current_selection))
    && strings(value.scene_ids) && strings(value.candidate_ids) && value.candidate_ids.every(sha)
    && typeof value.adopted === "boolean" && value.preview_independently_reviewed === false && value.provider_calls === 0) {
    const optional = Object.fromEntries(["version_id", "original_version_id", "usage_asset_id", "master_file_id", "preview_file_id"]
      .map(key => [key, positive(value[key]) ? value[key] : null]));
    return { version: value.version, job_id: value.job_id, asset_id: value.asset_id, target_asset_id: value.target_asset_id,
      status: value.status, mode: value.mode, stage: value.stage, scene_ids: value.scene_ids, candidate_ids: value.candidate_ids,
      adopted: value.adopted, current_selection: value.current_selection, preview_independently_reviewed: false,
      provider_calls: 0, retryable: false, ...optional } as ClarityResult;
  }
  return null;
}

export function clarityMoney(currency: string, minor: number) { return `${currency} ${(minor / 100).toFixed(2)}`; }
export function clarityCostLabel(cost: ClarityCost): string {
  if (cost.incurred_minor === null || cost.unknown_executions > 0) return `待核对（已知已发生 ${clarityMoney(cost.currency, cost.known_incurred_minor)}）`;
  return clarityMoney(cost.currency, cost.incurred_minor);
}
export function clarityQualityLabel(status: string): string {
  return ({ pending: "复检中", qualified: "复检通过", partial: "部分区间复检通过", failed: "复检未通过", unknown: "复检结论待核对" } as Record<string, string>)[status] ?? "复检结论待核对";
}
export function clarityConfirmationValid(value: unknown, now = Date.now()): value is ClarityConfirmation {
  if (!record(value)) return false;
  const budget = value.research_model_budget;
  if (value.funding_purpose === "research" && (!record(budget) || budget.currency !== "CNY"
    || !positive(budget.max_minor) || !positive(budget.call_max_minor) || !positive(budget.max_calls)
    || budget.max_calls > 128 || budget.call_max_minor * budget.max_calls > budget.max_minor)) return false;
  if (value.funding_purpose !== "research" && budget !== undefined) return false;
  return record(value) && (value.funding_purpose === undefined || ["commercial", "research"].includes(String(value.funding_purpose)))
    && value.risk_copy_version === "video-clarity-risk:v1"
    && ["CNY", "USD", "EUR"].includes(String(value.currency)) && amount(value.estimated_minor)
    && amount(value.max_minor) && value.estimated_minor <= value.max_minor
    && typeof value.expires_at === "string" && Date.parse(value.expires_at) > now;
}
export function clarityRange(start: number, end: number) { return `${start.toFixed(1)}–${end.toFixed(1)} 秒`; }
