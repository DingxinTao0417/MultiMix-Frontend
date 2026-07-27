import type { VideoQualityIssue, VideoQualityReport } from "../lib/video-quality";
import { qualitySegmentNumber, videoQualityIssueTitle } from "../lib/video-quality";
import type { RenderedReviewState } from "@/editor-engine/vendor/renderedReview";

export function RenderedReviewStatusPanel({
  review,
  onRetry,
}: {
  review: RenderedReviewState;
  onRetry?: () => void;
}) {
  const busy = ["pending", "reviewing", "stale", "repairing"].includes(review.status);
  const passed = review.status === "passed";
  const blocked = ["blocked", "blocked_requires_user_choice"].includes(review.status);
  const unavailable = review.status === "unavailable";
  const title = review.status === "repairing"
    ? "正在定点优化问题分镜"
    : busy
      ? "正在看片优化"
    : passed
      ? "画面检查已通过"
      : review.status === "blocked_requires_user_choice"
        ? "检测到手工编辑，需要你确认"
      : unavailable
        ? "画面检查暂不可用，可稍后重试"
        : "画面需要调整";

  return (
    <section
      className={`shadcn-prototype-video-quality ${
        blocked ? "blocked" : passed ? "passed" : "warning"
      }`}
      aria-label="成片画面检查"
      role={blocked || unavailable ? "alert" : "status"}
    >
      <header>
        <div>
          <strong>{title}</strong>
          <span>
            {busy
              ? "系统正在检查实际成片画面，不会用预估结果冒充通过。"
              : passed
                ? "本次结果与当前工程版本一致。"
                : unavailable
                  ? "当前没有得出可靠结论，系统不会把它标记为通过。"
                  : "请按下面点名的分镜调整后重新检查。"}
          </span>
        </div>
        {unavailable && onRetry ? (
          <button type="button" onClick={onRetry}>重新检查画面</button>
        ) : null}
      </header>
      {blocked && review.issues.length ? (
        <div className="shadcn-prototype-video-quality-list">
          {review.issues.map((issue, index) => {
            const segmentNumber = qualitySegmentNumber(issue.scene_id);
            return (
              <article key={`${issue.code}-${issue.scene_id}-${index}`}>
                <div>
                  <strong>
                    {segmentNumber == null
                      ? "当前工程需要调整"
                      : `第 ${segmentNumber} 段需要调整`}
                  </strong>
                  <p>{issue.reason}</p>
                  {issue.suggested_action ? (
                    <small>建议：{issue.suggested_action}</small>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export default function VideoQualityPanel({
  report,
  onLocate,
  onRepair,
  canRepair,
  onRecheck,
}: {
  report: VideoQualityReport;
  onLocate: (segmentId: string, objectType: string) => void;
  onRepair?: (issue: VideoQualityIssue) => void;
  canRepair?: (issue: VideoQualityIssue) => boolean;
  onRecheck?: () => void;
}) {
  const issues = [...report.blockers, ...report.warnings];
  if (!issues.length) return null;

  return (
    <section
      className={`shadcn-prototype-video-quality ${report.blockers.length ? "blocked" : "warning"}`}
      aria-label="视频质量检查"
      role={report.blockers.length ? "alert" : "status"}
    >
      <header>
        <div>
          <strong>{report.blockers.length ? "导出前需要修复" : "导出提醒"}</strong>
          <span>
            {report.blockers.length
              ? `${report.blockers.length} 个问题会影响成片，修复并重新检查后才能导出。`
              : `${report.warnings.length} 个提醒不阻止导出。`}
          </span>
        </div>
        {onRecheck ? <button type="button" onClick={onRecheck}>重新检查</button> : null}
      </header>
      <div className="shadcn-prototype-video-quality-list">
        {issues.map((issue, index) => {
          const segmentNumber = qualitySegmentNumber(issue.segment_id);
          const repairable = Boolean(onRepair && canRepair?.(issue));
          return (
            <article key={`${issue.code}-${issue.segment_id ?? "project"}-${index}`}>
              <div>
                <strong>{videoQualityIssueTitle(issue)}</strong>
                <p>{issue.message}</p>
                {issue.attempted_fallbacks.length ? (
                  <small>已尝试：{issue.attempted_fallbacks.join("、")}</small>
                ) : null}
              </div>
              <div className="shadcn-prototype-video-quality-actions">
                {issue.segment_id ? (
                  <button
                    type="button"
                    onClick={() => onLocate(issue.segment_id!, issue.object_type)}
                  >
                    {segmentNumber == null ? "定位到问题分镜" : `定位到第 ${segmentNumber} 段`}
                  </button>
                ) : null}
                {repairable ? (
                  <button type="button" className="primary" onClick={() => onRepair?.(issue)}>
                    {issue.suggested_actions[0] ?? "修复"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
