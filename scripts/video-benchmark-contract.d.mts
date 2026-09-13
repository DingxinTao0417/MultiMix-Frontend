export type VideoBenchmarkCase = {
  schema_version: "video-benchmark-case:v2";
  case_id: string;
  benchmark_level: "technical_baseline" | "public_release_gold";
  scenario_family: string;
  evaluation_mode: "offline_contract" | "production_e2e";
  execution: {
    video_type: string;
    input_profile: string;
    ratio: string;
    target_seconds: number;
  };
  source_contract: {
    document_required: boolean;
    asset_roles: string[];
    preserve_source_audio: boolean;
  };
  case_fingerprint?: string;
  [key: string]: unknown;
};

export type VideoBenchmarkRunBinding = {
  schema_version: "video-benchmark-run-binding:v1";
  status: "bound" | "unbound";
  reason?: string;
  case_id: string | null;
  case_fingerprint: string | null;
  benchmark_level: "technical_baseline" | "public_release_gold" | null;
  scenario_family: string | null;
  input_fingerprint: string | null;
  inputs: Record<string, unknown> | null;
  candidate_video_sha256: string | null;
  reference_video_sha256: string | null;
};

export declare const VIDEO_BENCHMARK_CASE_VERSION: "video-benchmark-case:v2";
export declare const VIDEO_BENCHMARK_RUN_BINDING_VERSION: "video-benchmark-run-binding:v1";
export declare function canonicalJson(value: unknown): string;
export declare function canonicalSha256(value: unknown): string;
export declare function validateVideoBenchmarkCase(value: unknown): VideoBenchmarkCase;
export declare function loadVideoBenchmarkCase(input: {
  backendRoot: string;
  filename: string;
}): VideoBenchmarkCase & { case_fingerprint: string };
export declare function assertVideoBenchmarkExecution(
  benchmarkCase: VideoBenchmarkCase,
  execution: VideoBenchmarkCase["execution"],
): VideoBenchmarkCase["execution"];
export declare function unboundVideoBenchmarkRun(
  benchmarkCase?: VideoBenchmarkCase | null,
  reason?: string,
): VideoBenchmarkRunBinding;
export declare function bindVideoBenchmarkRun(input: {
  benchmarkCase: VideoBenchmarkCase;
  execution: VideoBenchmarkCase["execution"];
  sourceDocumentSha256?: string | null;
  sourceAssetSha256s?: string[];
  generationInstructionSha256: string;
  candidateVideoSha256?: string | null;
  referenceVideoSha256?: string | null;
}): VideoBenchmarkRunBinding;
export declare function verifySameInputAb(
  candidateBinding: VideoBenchmarkRunBinding,
  referenceReview: unknown,
): {
  status: "same_input_verified";
  case_fingerprint: string;
  input_fingerprint: string;
  reference_video_sha256: string;
  candidate_video_sha256: string | null;
};
