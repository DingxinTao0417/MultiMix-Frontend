export type VideoHumanReviewWarning = {
  code?: string;
  message?: string;
};

export type VideoHumanReviewInput = {
  candidateVideo: string;
  candidateVideoSha256?: string | null;
  referenceVideo?: string | null;
  referenceVideoSha256?: string | null;
  videoType: string;
  creativeDraftOnly: boolean;
  qualityWarnings?: VideoHumanReviewWarning[];
  benchmarkBinding?: unknown;
  sameInputAb?: unknown;
  videoPlan?: unknown;
  videoProject?: unknown;
};

export type RenderedHumanReview = {
  schema_version: "rendered-human-review:v1";
  benchmark: Record<string, unknown>;
  same_input_ab: Record<string, unknown>;
  candidate: Record<string, unknown>;
  reference: Record<string, unknown>;
  video_type: string;
  creative_draft_only: boolean;
  scene_windows: Array<Record<string, unknown>>;
  review: Record<string, unknown>;
  technical_signals: Record<string, unknown>;
  release: Record<string, unknown>;
  advisory_only: true;
  runtime_effects: { quality_gate: false; auto_repair: false };
};

export declare function buildRenderedHumanReview(
  input: VideoHumanReviewInput,
): RenderedHumanReview;

export declare function buildVideoHumanReviewReport(
  input: VideoHumanReviewInput | RenderedHumanReview,
): string;

export declare function writeVideoHumanReviewReport(
  input: VideoHumanReviewInput & { resultDir: string },
): string;
