export type HomepageShowcaseCase = {
  id: string;
  title: string;
  startPath: "从想法开始" | "用素材创作" | "修改现有视频";
  provided: string;
  result: string;
  posterUrl: string;
  videoUrl: string;
  originalVideoUrl?: string;
  originalPosterUrl?: string;
  process: readonly {
    label: "需求" | "方案" | "修改" | "成片";
    summary: string;
  }[];
  publicDisplayApproval: string;
  qualityReviewEvidence: string;
};

// Add only product-made cases with documented quality review and public display rights.
// Internal QA candidates and prototype placeholders do not belong in this list.
export const APPROVED_HOMEPAGE_CASES: readonly HomepageShowcaseCase[] = [];

export function publishableHomepageCases(
  cases: readonly HomepageShowcaseCase[],
): HomepageShowcaseCase[] {
  return cases
    .filter((item) =>
      Boolean(
        item.publicDisplayApproval.trim()
        && item.qualityReviewEvidence.trim()
        && item.posterUrl.trim()
        && item.videoUrl.trim(),
      ),
    )
    .slice(0, 3);
}
