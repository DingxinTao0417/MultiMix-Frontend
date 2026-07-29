export type VideoQualityIssue = {
  code: string;
  segment_id: string | null;
  object_type: string;
  message: string;
  suggested_actions: string[];
};

export type VideoQualityReport = {
  stage: "project" | "export_preflight" | "export_file" | string;
  status: "pass" | "warning" | "blocked";
  blockers: VideoQualityIssue[];
  warnings: VideoQualityIssue[];
};

export const hasBlockingVideoIssues = (report: VideoQualityReport | null): boolean =>
  Boolean(report?.blockers.length);

export function qualitySegmentNumber(segmentId: string | null): number | null {
  if (!segmentId) return null;
  const match = segmentId.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : null;
}

export function videoQualityIssueTitle(issue: VideoQualityIssue): string {
  const segmentNumber = qualitySegmentNumber(issue.segment_id);
  const prefix = segmentNumber == null ? "当前工程" : `第 ${segmentNumber} 段`;
  const labels: Record<string, string> = {
    main_track_gap: "主画面缺失",
    subtitle_too_many_lines: "字幕超过两行",
    mg_stale: " MG 与内容不一致",
    mg_failed: " MG 渲染失败",
    mg_not_ready: " MG 尚未完成",
    duration_out_of_range: "时长超出允许范围",
    naked_black_interval: "成片存在裸黑场",
    invalid_dimensions: "成片尺寸不正确",
    invalid_video_codec: "视频编码不正确",
    invalid_audio_codec: "音频编码不正确",
    decode_failed: "成片无法完整解码",
    verifier_unavailable: "成片检查工具不可用",
  };
  return `${prefix}${labels[issue.code] ?? "存在质量问题"}`;
}
