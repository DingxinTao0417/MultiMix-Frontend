import type { AssetProduct, AssetProductSegment } from "./asset-workspace-types";
import { isRecord, stringValue } from "./asset-workspace-shared";

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
  "materialFillStatus",
  "visualStatusLabel",
  "primaryVisualSourceType",
  "primaryVisualIdentity",
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
  return fields.some((field) => {
    const before = previous[field];
    const after = current[field];
    return before != null && after != null && JSON.stringify(before) !== JSON.stringify(after);
  });
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
      (previousStartSeconds != null && currentStartSeconds != null
        && !sameNumber(previousStartSeconds, currentStartSeconds))
      || (previousDurationSeconds != null && currentDurationSeconds != null
        && !sameNumber(previousDurationSeconds, currentDurationSeconds))
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
    ["title", "标题"], ["line", "旁白"], ["subLine", "字幕"], ["voiceName", "声音"],
    ["assetTitle", "素材名称"], ["visualTreatmentLabel", "画面处理"],
    ["backgroundTreatmentLabel", "背景"], ["mgLabel", "图形动效"],
    ["graphicComponentLabel", "图形组件"],
  ];
  for (const [field, label] of textFields) {
    const before = previous[field];
    const after = current[field];
    if (typeof before === "string" && typeof after === "string"
      && before.trim() !== after.trim()) {
      details.push({
        label,
        before: before.trim() || "未设置",
        after: after.trim() || "已清除",
      });
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
  if (change.changeKinds.includes("copy")) summary.push(change.previousSegment.line != null
    && change.currentSegment.line != null
    && change.previousSegment.line !== change.currentSegment.line
    ? "旁白已调整" : "文案已调整");
  if (change.changeKinds.includes("visual")) {
    const previousAssetId = change.previousSegment.assetReferenceId;
    const currentAssetId = change.currentSegment.assetReferenceId;
    const previousPrimaryIdentity = change.previousSegment.primaryVisualIdentity;
    const currentPrimaryIdentity = change.currentSegment.primaryVisualIdentity;
    const isConfirmedSavedAssetReplacement = previousAssetId != null
      && currentAssetId != null
      && previousAssetId !== currentAssetId
      && change.previousSegment.primaryVisualSourceType === "saved_asset"
      && change.currentSegment.primaryVisualSourceType === "saved_asset"
      && change.previousSegment.primaryVisualPersisted === true
      && change.currentSegment.primaryVisualPersisted === true
      && previousPrimaryIdentity === `saved_asset:asset:${previousAssetId}`
      && currentPrimaryIdentity === `saved_asset:asset:${currentAssetId}`;
    summary.push(isConfirmedSavedAssetReplacement
      ? "素材已更换"
      : change.previousSegment.assetTitle != null
        && change.currentSegment.assetTitle != null
        && change.previousSegment.assetTitle !== change.currentSegment.assetTitle
        ? "素材信息已调整" : "画面已调整");
  }
  if (change.changeKinds.includes("mg")) summary.push("图形动效已调整");
  if (change.changeKinds.includes("structure")) summary.push("顺序已调整");
  return summary.join("；");
}

export type VideoVersionOverviewChange = { label: string; before: string; after: string };

function videoProject(product: AssetProduct): Record<string, unknown> | null {
  const metadata = isRecord(product.metadata) ? product.metadata : null;
  return metadata && isRecord(metadata.video_project) ? metadata.video_project : null;
}

function bgmChoice(product: AssetProduct): { identity: string; label: string | null } | null {
  const project = videoProject(product);
  const metadata = isRecord(product.metadata) ? product.metadata : null;
  const projectMetadata = project && isRecord(project.metadata) ? project.metadata : null;
  const choice = isRecord(projectMetadata?.bgm_choice) ? projectMetadata.bgm_choice
    : isRecord(metadata?.bgm_choice) ? metadata.bgm_choice : null;
  if (!choice) return null;
  if (choice.enabled === false) return { identity: "off", label: "已关闭" };
  const catalogId = stringValue(choice.catalog_id);
  if (!catalogId) return null;
  const media = Array.isArray(project?.media) ? project.media.filter(isRecord) : [];
  const selected = media.find((item) => stringValue(item.file_path) === `bgm://${catalogId}`
    || (isRecord(item.metadata) && stringValue(item.metadata.catalog_id) === catalogId));
  return { identity: `catalog:${catalogId}`, label: stringValue(selected?.name) || null };
}

export function compareVideoVersionOverview(previous: AssetProduct, current: AssetProduct): VideoVersionOverviewChange[] {
  const changes: VideoVersionOverviewChange[] = [];
  const knownRatios = new Set(["9:16", "16:9", "1:1"]);
  if (knownRatios.has(previous.ratio) && knownRatios.has(current.ratio) && previous.ratio !== current.ratio) {
    changes.push({ label: "画幅", before: previous.ratio, after: current.ratio });
  }
  const previousDuration = normalizedNumber(videoProject(previous)?.duration_seconds as number | undefined);
  const currentDuration = normalizedNumber(videoProject(current)?.duration_seconds as number | undefined);
  if (previousDuration != null && currentDuration != null && !sameNumber(previousDuration, currentDuration)) {
    changes.push({ label: "全片时长", before: secondsLabel(previousDuration), after: secondsLabel(currentDuration) });
  }
  const previousBgm = bgmChoice(previous);
  const currentBgm = bgmChoice(current);
  if (previousBgm && currentBgm && previousBgm.identity !== currentBgm.identity) {
    changes.push({ label: "背景音乐", before: previousBgm.label || "旧配乐（名称未记录）",
      after: currentBgm.label || "新配乐（名称未记录）" });
  }
  return changes;
}
