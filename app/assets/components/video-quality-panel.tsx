import type { VideoQualityIssue, VideoQualityReport } from "../lib/video-quality";
import { qualitySegmentNumber, videoQualityIssueTitle } from "../lib/video-quality";

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
      className="shadcn-prototype-video-quality warning"
      aria-label="视频质量检查"
      role="status"
    >
      <header>
        <div>
          <strong>导出提醒</strong>
          <span>
            {report.blockers.length
              ? `${report.blockers.length} 个问题可能影响成片；本次测试仍可继续导出。`
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
