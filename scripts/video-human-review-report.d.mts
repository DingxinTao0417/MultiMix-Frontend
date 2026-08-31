export type VideoHumanReviewWarning = {
  code?: string;
  message?: string;
};

export type VideoHumanReviewInput = {
  candidateVideo: string;
  videoType: string;
  creativeDraftOnly: boolean;
  qualityWarnings?: VideoHumanReviewWarning[];
};

export declare function buildVideoHumanReviewReport(input: VideoHumanReviewInput): string;

export declare function writeVideoHumanReviewReport(
  input: VideoHumanReviewInput & { resultDir: string },
): string;
