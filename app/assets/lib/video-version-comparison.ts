import type { AssetProductSegment } from "./asset-workspace-types";

export type VideoSegmentChangeKind = "timing" | "visual" | "copy" | "mg" | "structure";

export type VideoVersionSegmentChange = {
  id: string;
  index: number;
  title: string;
  previousSegment: AssetProductSegment | null;
  currentSegment: AssetProductSegment | null;
  previousStartSeconds: number | null;
  currentStartSeconds: number | null;
  previousDurationSeconds: number | null;
  currentDurationSeconds: number | null;
  changeKinds: VideoSegmentChangeKind[];
};

const VISUAL_FIELDS: Array<keyof AssetProductSegment> = [
  "assetTitle",
  "assetThumbnailUrl",
  "isFallback",
  "materialFillStatus",
  "visualStatusLabel",
  "primaryVisualSourceType",
  "primaryVisualPersisted",
  "primaryVisualMediaType",
  "primaryVisualTreatment",
  "visualTreatmentLabel",
  "backgroundTreatmentLabel",
];

const COPY_FIELDS: Array<keyof AssetProductSegment> = [
  "title",
  "line",
  "subLine",
  "voiceName",
];

const MG_FIELDS: Array<keyof AssetProductSegment> = [
  "mgLabel",
  "mgStatus",
  "graphicComponentLabel",
];

function normalizedNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function durationSeconds(segment: AssetProductSegment | null): number | null {
  if (!segment) return null;
  const start = normalizedNumber(segment.startSeconds);
  const end = normalizedNumber(segment.endSeconds);
  return start == null || end == null ? null : Math.max(0, end - start);
}

function sameNumber(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return left === right;
  return Math.abs(left - right) < 0.001;
}

function anyFieldChanged(
  previous: AssetProductSegment,
  current: AssetProductSegment,
  fields: Array<keyof AssetProductSegment>,
): boolean {
  return fields.some((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(current[field] ?? null));
}

function segmentChange(
  previousSegment: AssetProductSegment | null,
  currentSegment: AssetProductSegment | null,
): VideoVersionSegmentChange | null {
  const reference = currentSegment ?? previousSegment;
  if (!reference) return null;
  const previousStartSeconds = normalizedNumber(previousSegment?.startSeconds);
  const currentStartSeconds = normalizedNumber(currentSegment?.startSeconds);
  const previousDurationSeconds = durationSeconds(previousSegment);
  const currentDurationSeconds = durationSeconds(currentSegment);
  const changeKinds: VideoSegmentChangeKind[] = [];

  if (!previousSegment || !currentSegment) {
    changeKinds.push("structure");
  } else {
    if (previousSegment.index !== currentSegment.index) changeKinds.push("structure");
    if (
      !sameNumber(previousStartSeconds, currentStartSeconds)
      || !sameNumber(previousDurationSeconds, currentDurationSeconds)
    ) changeKinds.push("timing");
    if (anyFieldChanged(previousSegment, currentSegment, VISUAL_FIELDS)) changeKinds.push("visual");
    if (anyFieldChanged(previousSegment, currentSegment, COPY_FIELDS)) changeKinds.push("copy");
    if (anyFieldChanged(previousSegment, currentSegment, MG_FIELDS)) changeKinds.push("mg");
  }

  if (!changeKinds.length) return null;
  const index = reference.index;
  return {
    id: reference.id || `segment-index-${index}`,
    index,
    title: reference.title || reference.line || `分镜 ${index}`,
    previousSegment,
    currentSegment,
    previousStartSeconds,
    currentStartSeconds,
    previousDurationSeconds,
    currentDurationSeconds,
    changeKinds,
  };
}

export function compareVideoVersionSegments(
  previousSegments: AssetProductSegment[] | undefined,
  currentSegments: AssetProductSegment[] | undefined,
): VideoVersionSegmentChange[] {
  const previous = previousSegments ?? [];
  const current = currentSegments ?? [];
  const previousById = new Map(
    previous.filter((segment) => Boolean(segment.id)).map((segment) => [segment.id, segment] as const),
  );
  const previousWithoutIdByIndex = new Map(
    previous.filter((segment) => !segment.id).map((segment) => [segment.index, segment] as const),
  );
  const consumedPrevious = new Set<AssetProductSegment>();
  const changes: VideoVersionSegmentChange[] = [];

  for (const currentSegment of current) {
    const previousSegment = currentSegment.id
      ? previousById.get(currentSegment.id) ?? null
      : previousWithoutIdByIndex.get(currentSegment.index) ?? null;
    if (previousSegment) consumedPrevious.add(previousSegment);
    const change = segmentChange(previousSegment, currentSegment);
    if (change) changes.push(change);
  }

  for (const previousSegment of previous) {
    if (consumedPrevious.has(previousSegment)) continue;
    const change = segmentChange(previousSegment, null);
    if (change) changes.push(change);
  }

  return changes;
}

export type VideoSegmentChangeDetail = { label: string; before: string; after: string };

function secondsLabel(value: number): string {
  return `${Number(value.toFixed(2))} 秒`;
}

export function videoSegmentChangeDetails(change: VideoVersionSegmentChange): VideoSegmentChangeDetail[] {
  const details: VideoSegmentChangeDetail[] = [];
  const previous = change.previousSegment;
  const current = change.currentSegment;
  if (!previous || !current) return details;

  if (change.previousDurationSeconds != null && change.currentDurationSeconds != null
    && !sameNumber(change.previousDurationSeconds, change.currentDurationSeconds)) {
    details.push({ label: "时长", before: secondsLabel(change.previousDurationSeconds), after: secondsLabel(change.currentDurationSeconds) });
  }
  if (change.previousStartSeconds != null && change.currentStartSeconds != null
    && !sameNumber(change.previousStartSeconds, change.currentStartSeconds)) {
    details.push({ label: "起点", before: secondsLabel(change.previousStartSeconds), after: secondsLabel(change.currentStartSeconds) });
  }
  const textFields: Array<[keyof AssetProductSegment, string]> = [
    ["title", "标题"], ["line", "口播"], ["subLine", "字幕"], ["voiceName", "声音"],
    ["assetTitle", "素材"], ["visualTreatmentLabel", "画面处理"],
    ["backgroundTreatmentLabel", "背景"], ["mgLabel", "图形动效"],
    ["graphicComponentLabel", "图形组件"],
  ];
  for (const [field, label] of textFields) {
    const before = previous[field];
    const after = current[field];
    if (typeof before === "string" && before.trim() && typeof after === "string" && after.trim()
      && before.trim() !== after.trim()) {
      details.push({ label, before: before.trim(), after: after.trim() });
    }
  }
  return details;
}

export function videoSegmentChangeSummary(change: VideoVersionSegmentChange): string {
  if (!change.previousSegment) return "新增分镜";
  if (!change.currentSegment) return "移除分镜";
  const summary: string[] = [];
  if (change.previousDurationSeconds != null && change.currentDurationSeconds != null
    && !sameNumber(change.previousDurationSeconds, change.currentDurationSeconds)) {
    summary.push(`时长 ${Number(change.previousDurationSeconds.toFixed(2))}→${Number(change.currentDurationSeconds.toFixed(2))} 秒`);
  } else if (change.changeKinds.includes("timing")) summary.push("位置已调整");
  if (change.changeKinds.includes("copy")) summary.push(change.previousSegment.line !== change.currentSegment.line
    ? "口播已调整" : "文案已调整");
  if (change.changeKinds.includes("visual")) summary.push(change.previousSegment.assetTitle !== change.currentSegment.assetTitle
    && change.previousSegment.assetTitle && change.currentSegment.assetTitle ? "素材已更换" : "画面已调整");
  if (change.changeKinds.includes("mg")) summary.push("图形动效已调整");
  if (change.changeKinds.includes("structure")) summary.push("顺序已调整");
  return summary.join("；");
}
