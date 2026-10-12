export type ClarityCost = { currency: string; incurred_minor: number | null; known_incurred_minor: number; unknown_executions: number };
export type ClarityInterval = {
  interval_id: string; scene_id: string; start_seconds: number; end_seconds: number;
  status: string; qualified: boolean; adopted: false; candidate_available: boolean;
  candidate_id?: string | null; candidate_file_id?: number | null; processing_fee_minor?: 0 | null;
  review?: { improvement?: string | null; fidelity?: string | null; temporal?: string | null;
    obvious_artifacts?: string[] | null; uncertainty?: string[] | null } | null;
};
export type ClarityEnhancementResult = {
  version: "video-clarity-result:v1"; job_id: string; asset_id: number;
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "canceled";
  quality_status: "pending" | "qualified" | "partial" | "failed" | "unknown";
  stage: string; adopted: false; retryable: false; intervals: ClarityInterval[];
  funding_purpose?: "commercial" | "research";
  research_model_cost?: ClarityCost;
  processing_cost: ClarityCost; payment: { status: "receipts_available" | "unverified"; settled_minor: number | null };
  delivery: { confirmed_at: string; target_seconds: 600; elapsed_seconds: number;
    result_ready_at: string | null; target_met: boolean | null }; needs_reconciliation: boolean;
};
export type ClarityAdoptionResult = {
  version: "video-clarity-adoption-result:v1"; job_id: string; asset_id: number; target_asset_id: number;
  status: ClarityEnhancementResult["status"]; stage: string; mode: "source_usage" | "scene_primary" | "film_delivery";
  scene_ids: string[]; candidate_ids: string[]; adopted: boolean;
  current_selection: "adopted" | "original" | "other" | "pending";
  version_id?: number | null; original_version_id?: number | null; usage_asset_id?: number | null;
  master_file_id?: number | null; preview_file_id?: number | null; preview_independently_reviewed: false;
  provider_calls: 0; retryable: false;
};
export type ClarityResult = ClarityEnhancementResult | ClarityAdoptionResult;
export type ClarityConfirmation = { research_model_budget?: {currency:string;max_minor:number;call_max_minor:number;max_calls:number}; funding_purpose?: "commercial" | "research"; risk_copy_version: string; currency: string; estimated_minor: number; max_minor: number; expires_at: string };
export type ClarityComparisonMedia = { preview_url: string; native_sha256: string; width: number; height: number };
export type ClarityCandidate = {
  candidate_id: string; file_id: number; interval_id: string; scene_id: string;
  start_seconds: number; end_seconds: number; review_status: string; adopted: boolean;
  comparison: { original: ClarityComparisonMedia; candidate: ClarityComparisonMedia; preview_independently_reviewed: false } | null;
};
export type ClarityShot = {
  interval_id: string; scene_id: string; start_seconds: number; end_seconds: number;
  boundary_source: "actual_cut" | "project_mapping_verified"; boundary_fingerprint: string;
};
export type ClarityReview = {
  requested_asset_id: number; asset_id: number; version_id: number | null; source_variant: "original" | "brand_showcase";
  status: "not_reviewed" | "queued" | "running" | "reviewed" | "insufficient" | "unavailable";
  coverage_complete: boolean; profile_current: boolean; failure: string | null; scope: "shot_sampled_windows" | null;
  processing_scope: "whole_shot" | null; shot_boundaries: ClarityShot[]; eligible_intervals: ClarityShot[];
  observations: { scene_id: string; coverage: string; boundary_verification: string; observed_blur: string;
    blur_scope: string; obvious_artifacts: string[]; actionability: string; evidence: string; uncertainty: string[];
  }[];
};
