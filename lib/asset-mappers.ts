// Maps backend ContentAsset / AssetConversationResponse shapes into the
// frontend AssetProduct / AssetConversation contract. Ported from ChangeIn
// frontend assets-workspace-client.tsx helpers.

import { confirmationMessagePresentation } from "../app/assets/lib/conversation-execution-presentation";
import type { AgentRunStep, AssetConversation, AssetConversationMessage, AssetMessagePlan, AssetPlanField, AssetPlanRatioOption, AssetPlanRef, AssetProduct, AssetProductMode, AssetProductSegment, AssetProductSourceRef, AssetProductSourceSummary, AssetSuggestionAction } from "../app/assets/lib/asset-workspace-types";
import { API_BASE, type AssetConversationResponse, type ContentAsset } from "./api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRatioLabel(value: string): string {
  const normalized = value.replace(/：/g, ":").trim();
  const ratio = normalized.match(/\d+(?:\.\d+)?:\d+(?:\.\d+)?/);
  if (ratio) return ratio[0];
  return normalized.replace(/(?:横屏|竖屏|横版|竖版|横向|竖向|landscape|portrait)/gi, "").trim();
}

function stringListValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function suggestionActionsValue(value: unknown): AssetSuggestionAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions = value.flatMap((item): AssetSuggestionAction[] => {
    if (!isRecord(item)) return [];
    const label = stringValue(item.label);
    const utterance = stringValue(item.utterance) || label;
    if (!label || !utterance) return [];
    return [{
      id: stringValue(item.id) || label,
      label,
      utterance,
      actionType: stringValue(item.action_type) || "fill_composer",
      capability: stringValue(item.capability) || undefined,
      mode: stringValue(item.mode) || undefined,
      enabled: item.enabled !== false,
      disabledReason: stringValue(item.disabled_reason) || undefined,
      requiresConfirmation: item.requires_confirmation !== false
    }];
  });
  return actions.length ? actions : undefined;
}

// Store refs (local://, supabase://, s3://) are only readable through the
// backend media proxy; plain http(s) URLs pass through untouched.
function planThumbnailUrl(ref: string): string | undefined {
  if (!ref) return undefined;
  if (/^https?:\/\//i.test(ref)) return ref;
  if (/^[a-z0-9+.-]+:\/\//i.test(ref)) return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
  return undefined;
}

function planRefsValue(value: unknown): AssetPlanRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value.flatMap((item): AssetPlanRef[] => {
    if (!isRecord(item)) return [];
    const title = stringValue(item.title) || stringValue(item.label);
    if (!title) return [];
    return [{
      id: item.id != null ? String(item.id) : item.asset_id != null ? String(item.asset_id) : undefined,
      title,
      thumbnailUrl: planThumbnailUrl(stringValue(item.thumbnail_url) || stringValue(item.preview_url) || stringValue(item.ref))
    }];
  });
  return refs.length ? refs : undefined;
}

function planFieldsValue(value: unknown): AssetPlanField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): AssetPlanField[] => {
    if (!isRecord(item)) return [];
    const label = stringValue(item.label);
    const fieldValue = stringValue(item.value);
    if (!label || !fieldValue) return [];
    return [{
      key: stringValue(item.key) || `plan-field-${index}`,
      label,
      value: fieldValue,
      refs: planRefsValue(item.refs)
    }];
  });
}

// Structured confirmation plan from an assistant message's metadata (spec §5.2).
// Returns undefined when the payload is missing or has no usable fields so the
// UI falls back to plain message + suggestion chips (spec §12 降级规则).
function planFromMetadata(value: unknown): AssetMessagePlan | undefined {
  if (!isRecord(value)) return undefined;
  const title = stringValue(value.title);
  const fields = planFieldsValue(value.fields);
  if (!title || !fields.length) return undefined;
  const status = stringValue(value.status) === "confirmed" ? "confirmed" : "pending";
  const summaryFields = planFieldsValue(value.summary_fields);
  const ratioOptions = planRatioOptionsValue(value.ratio_options);
  return {
    title,
    status,
    subtitle: stringValue(value.subtitle) || undefined,
    fields,
    summaryFields: summaryFields.length ? summaryFields : undefined,
    confirmLabel: stringValue(value.confirm_label) || undefined,
    adjustLabel: stringValue(value.adjust_label) || undefined,
    confirmUtterance: stringValue(value.confirm_utterance) || undefined,
    ratioOptions: ratioOptions.length ? ratioOptions : undefined,
    ratioDefault: stringValue(value.ratio_default) || undefined
  };
}

// Video-size options for the confirm card's ratio toggle (spec §5.2). Each entry
// needs a canonical value + label; malformed entries are dropped so the toggle
// only offers real choices (empty → card hides the toggle, spec §12 降级规则).
function planRatioOptionsValue(value: unknown): AssetPlanRatioOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AssetPlanRatioOption[] => {
    if (!isRecord(item)) return [];
    const ratioValue = stringValue(item.value);
    const label = stringValue(item.label);
    if (!ratioValue || !label) return [];
    return [{ value: ratioValue, label }];
  });
}

export function relativeTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "刚刚";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}分钟前`;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return "今天";
  if (date.getTime() >= startOfToday - 86_400_000) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function markdownToParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((item) => item.replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function firstMeaningfulLine(markdown: string): string | undefined {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find((line) => line && !/^[-*]\s*Source note/i.test(line));
}

function formatTimelineSecond(value: number): string {
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timelineFromBody(markdown: string, unsupported: boolean) {
  if (unsupported) return [];
  const matches = Array.from(markdown.matchAll(/(?:^|\n)(?:#{2,4}\s*)?(?:分镜|Scene)\s*([0-9一二三四五六七八九十]+)?[:：]?\s*([^\n]*)/gi));
  return matches.slice(0, 5).map((match, index) => ({
    time: `00:${String(index * 12).padStart(2, "0")}`,
    title: (match[2] || `分镜 ${index + 1}`).trim(),
    status: "草稿"
  }));
}

function timelineFromVideoProject(videoProject: Record<string, unknown> | undefined) {
  const timeline = isRecord(videoProject?.timeline) ? videoProject.timeline : undefined;
  const tracks = Array.isArray(timeline?.tracks) ? timeline.tracks : [];
  const textTrack = tracks.find((track) => isRecord(track) && track.type === "text");
  const elements = isRecord(textTrack) && Array.isArray(textTrack.elements) ? textTrack.elements : [];
  if (!elements.length) {
    const segments = Array.isArray(videoProject?.segments) ? videoProject.segments.filter(isRecord) : [];
    if (!segments.length) return undefined;
    return segments.slice(0, 8).map((segment, index) => ({
      time: formatTimelineSecond(typeof segment.startTime === "number" ? segment.startTime : index * 8),
      title: stringValue(segment.title) || `片段 ${index + 1}`,
      status: stringValue(segment.material_state) || stringValue(segment.voiceover_state) || "待执行",
      line: stringValue(segment.narration) || stringValue(segment.subtitle)
    }));
  }
  return elements.slice(0, 8).filter(isRecord).map((element, index) => {
    const start = typeof element.startTime === "number" ? element.startTime : index * 8;
    return {
      time: formatTimelineSecond(start),
      title: `片段 ${index + 1}`,
      status: "字幕轨道",
      line: stringValue(element.content) || "字幕待生成"
    };
  });
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Store refs (local://, supabase://, s3://) are only readable through the
// backend media proxy; plain http(s) URLs pass through untouched.
function thumbnailUrlFromRef(ref: string): string | undefined {
  if (!ref) return undefined;
  if (/^https?:\/\//i.test(ref)) return ref;
  if (/^[a-z0-9+.-]+:\/\//i.test(ref)) return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
  return undefined;
}

type SegmentTiming = { start: number; end: number };

function segmentTimingsFromProject(project: Record<string, unknown> | undefined): Map<string, SegmentTiming> {
  const timings = new Map<string, SegmentTiming>();
  if (!project || !Array.isArray(project.tracks)) return timings;
  for (const track of project.tracks) {
    if (!isRecord(track) || !Array.isArray(track.elements)) continue;
    for (const element of track.elements) {
      if (!isRecord(element)) continue;
      const segmentId = stringValue(element.segmentId);
      const start = numberOrUndefined(element.startTime);
      const duration = numberOrUndefined(element.duration);
      if (!segmentId || start == null || duration == null || duration < 0) continue;
      const end = start + duration;
      const previous = timings.get(segmentId);
      timings.set(segmentId, {
        start: previous ? Math.min(previous.start, start) : start,
        end: previous ? Math.max(previous.end, end) : end,
      });
    }
  }
  return timings;
}

// Storyboard summary for the segment cards. Reads the semantic layer in
// priority order: video_project.segments → video_segments → video_plan.scenes.
// asset_reference / mg_decision are authoritative; stock is fallback only.
function segmentsFromVideoMetadata(metadata: Record<string, unknown>): AssetProductSegment[] | undefined {
  const videoProject = isRecord(metadata.video_project) ? metadata.video_project : undefined;
  const projectTimings = segmentTimingsFromProject(videoProject);
  const videoPlan = isRecord(metadata.video_plan) ? metadata.video_plan : undefined;
  const rawSegments = Array.isArray(videoProject?.segments) && videoProject.segments.length
    ? videoProject.segments
    : Array.isArray(metadata.video_segments) && metadata.video_segments.length
      ? metadata.video_segments
      : Array.isArray(videoPlan?.scenes)
        ? videoPlan.scenes
        : [];
  const records = rawSegments.filter(isRecord);
  if (!records.length) return undefined;
  return records.map((segment, index) => {
    const reference = isRecord(segment.asset_reference) ? segment.asset_reference : null;
    const snapshot = reference && isRecord(reference.source_snapshot) ? reference.source_snapshot : null;
    const decision = isRecord(segment.mg_decision) ? segment.mg_decision : null;
    const visible = decision && isRecord(decision.visible_summary) ? decision.visible_summary : null;
    const projectTiming = projectTimings.get(stringValue(segment.id));
    const start = projectTiming?.start ?? numberOrUndefined(segment.startTime) ?? numberOrUndefined(segment.start_seconds);
    const duration = numberOrUndefined(segment.duration) ?? numberOrUndefined(segment.duration_seconds);
    const end = projectTiming?.end ?? numberOrUndefined(segment.endTime) ?? (start != null && duration != null ? start + duration : undefined);
    return {
      id: stringValue(segment.id) || `segment-${index + 1}`,
      index: index + 1,
      title: stringValue(segment.title) || undefined,
      startSeconds: start,
      endSeconds: end,
      line: stringValue(segment.narration) || stringValue(segment.line) || undefined,
      subLine: stringValue(segment.subtitle_focus) || stringValue(segment.subtitle) || undefined,
      assetTitle: stringValue(snapshot?.title) || undefined,
      assetThumbnailUrl: thumbnailUrlFromRef(
        stringValue(snapshot?.preview_url) || stringValue(snapshot?.thumbnail_url) || stringValue(snapshot?.original_ref)
      ),
      isFallback: Boolean(reference) && stringValue(reference?.status) !== "matched",
      mgLabel: decision?.needed === true
        ? stringValue(visible?.label) || stringValue(decision.chosen_template) || "MG"
        : undefined,
      mgStatus: decision?.needed === true ? stringValue(decision.status) || undefined : undefined,
    };
  });
}

function sourceRefStateLabel(state: string): string | undefined {
  const normalized = state.toLowerCase();
  if (normalized === "ready" || normalized === "parsed" || normalized === "matched") return "已解析";
  if (normalized === "processing" || normalized === "pending") return "处理中";
  if (normalized === "failed") return "解析失败";
  return undefined;
}

// Product-level source summary for the source-ref block. Built only from data
// that is actually present (source_mapping and/or segment references); returns
// undefined when there is nothing real to show.
function sourceSummaryForAsset(asset: ContentAsset, segments: AssetProductSegment[] | undefined): AssetProductSourceSummary | undefined {
  const mapping = Array.isArray(asset.source_mapping) ? asset.source_mapping.filter(isRecord) : [];
  const refs: AssetProductSourceRef[] = mapping.flatMap((item, index): AssetProductSourceRef[] => {
    const title = stringValue(item.title);
    if (!title) return [];
    return [{
      id: item.asset_id != null ? String(item.asset_id) : stringValue(item.url) || `source-${index + 1}`,
      title,
      statusLabel: sourceRefStateLabel(stringValue(item.state)),
      referenceCount: numberOrUndefined(item.reference_count),
      thumbnailUrl: thumbnailUrlFromRef(stringValue(item.preview_url) || stringValue(item.thumbnail_url)),
      isFallback: stringValue(item.source_type) === "public_source" || undefined
    }];
  });
  if (segments?.length) {
    const matched = segments.filter((segment) => segment.assetTitle && !segment.isFallback).length;
    const fallback = segments.filter((segment) => segment.isFallback).length;
    if (matched || fallback) {
      if (!refs.length) {
        const seen = new Set<string>();
        for (const segment of segments) {
          if (!segment.assetTitle || seen.has(segment.assetTitle)) continue;
          seen.add(segment.assetTitle);
          refs.push({
            id: `segment-asset-${segment.index}`,
            title: segment.assetTitle,
            thumbnailUrl: segment.assetThumbnailUrl,
            isFallback: segment.isFallback || undefined
          });
        }
      }
      const parts = [
        matched ? `${matched} 个已保存素材` : "",
        fallback ? `${fallback} 段兜底素材` : ""
      ].filter(Boolean);
      return {
        headline: `基于 ${parts.join(" + ")}生成`,
        note: `素材命中率 ${matched}/${segments.length} · 兜底素材只在没有你的素材可用时使用`,
        refs
      };
    }
  }
  if (!refs.length) return undefined;
  return { headline: `基于 ${refs.length} 个素材生成`, refs };
}

function videoProjectStatusLabel(mp4State: string): string {
  if (mp4State === "ready") return "视频工程 · 已有导出文件";
  if (mp4State === "running") return "视频工程 · 处理中";
  if (mp4State === "failed") return "视频工程 · 处理失败";
  return "视频工程 · 可编辑";
}

// Human-readable label for a video job's render_stage (backend enum).
export function videoJobStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    queued: "排队等待中",
    script: "正在生成脚本",
    segment: "正在匹配素材与合成配音",
    render: "正在渲染动效",
    done: "已完成",
    failed: "生成失败",
    stale: "任务超时",
    missing_asset: "生成失败",
    invalid_spec: "动效参数无效"
  };
  return labels[stage] ?? "正在生成";
}

// Ordered pipeline steps shown by the progress UI; maps render_stage → index.
export const VIDEO_JOB_STEPS = ["生成脚本", "匹配素材与配音", "组装时间线"] as const;

export function videoJobStepIndex(stage: string): number {
  if (stage === "queued" || stage === "script") return 0;
  if (stage === "segment" || stage === "render") return 1;
  if (stage === "done") return 3;
  return 2;
}

// Merchant-facing timeline labels for the video pipeline (spec §5.2 ★). The
// backend only exposes a coarse render_stage today, so this maps that single
// signal onto the ≥3 semantic steps the timeline requires (§12 硬约定①).
export const VIDEO_JOB_TIMELINE_STEPS = [
  { key: "create_job", label: "创建视频工程任务" },
  { key: "prepare_scenes", label: "读取已确认方案并准备分镜" },
  { key: "prepare_media", label: "匹配分镜素材并准备配音、字幕" },
  { key: "build_project", label: "组装可编辑视频工程" }
] as const;

export type AgentTimelineStep = AgentRunStep;

// Backend semantic step (spec §5.2 ★): key/label/status + real elapsed seconds.
export type VideoJobBackendStep = {
  key: string;
  label: string;
  status: string;
  elapsedSeconds?: number | null;
  retryJobId?: string | null;
};

// Format real elapsed seconds into a merchant-facing label ("8秒" / "1分12秒").
function formatStepElapsed(seconds: number): string | undefined {
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    if (rounded <= 0) return undefined;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}秒`;
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}分${rest}秒` : `${minutes}分`;
}

// Prefer the backend's real steps[] when present. The status enum and elapsed
// times come straight from the job (no fake progress); an empty/missing array
// makes the caller fall back to videoJobTimelineSteps (spec §12 降级规则).
export function agentTimelineStepsFromBackend(steps: VideoJobBackendStep[] | undefined | null): AgentTimelineStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step): AgentTimelineStep[] => {
    const label = typeof step.label === "string" ? step.label.trim() : "";
    const key = typeof step.key === "string" ? step.key.trim() : "";
    if (!label || !key) return [];
    const status: AgentTimelineStep["status"] =
      step.status === "done" || step.status === "run" || step.status === "fail" ? step.status : "wait";
    const elapsedSeconds = typeof step.elapsedSeconds === "number" && Number.isFinite(step.elapsedSeconds)
      ? step.elapsedSeconds
      : undefined;
    const retryJobId = typeof step.retryJobId === "string" ? step.retryJobId : undefined;
    return [{
      key,
      label,
      status,
      elapsedSeconds,
      elapsedLabel: elapsedSeconds === undefined ? undefined : formatStepElapsed(elapsedSeconds),
      retryJobId,
    }];
  });
}

function videoJobTimelineStepIndex(stage: string): number {
  if (stage === "queued") return 0;
  if (stage === "script") return 1;
  if (stage === "segment") return 2;
  if (stage === "render") return 3;
  if (stage === "done") return 4;
  return 3;
}

// Build agent-timeline steps from a live video job's render_stage + status.
// Returns [] when there is no running/queued job so the caller keeps the plain
// shimmer fallback (spec §12: 无事件不渲染, 视频链路事件已有先上视频).
export function videoJobTimelineSteps(stage: string, status: string): AgentTimelineStep[] {
  const failed = status === "failed" || stage === "failed" || stage === "missing_asset" || stage === "invalid_spec" || stage === "stale";
  const activeIndex = videoJobTimelineStepIndex(stage);
  return VIDEO_JOB_TIMELINE_STEPS.map((step, index): AgentTimelineStep => {
    if (failed) {
      if (index < activeIndex) return { ...step, status: "done" };
      if (index === activeIndex) return { ...step, status: "fail" };
      return { ...step, status: "wait" };
    }
    if (activeIndex >= VIDEO_JOB_TIMELINE_STEPS.length) return { ...step, status: "done" };
    if (index < activeIndex) return { ...step, status: "done" };
    if (index === activeIndex) return { ...step, status: "run" };
    return { ...step, status: "wait" };
  });
}

function suggestionsForCapability(capability: string): string[] {
  if (capability === "video_script") return ["确认，生成视频工程", "语气更口语", "缩短到30秒", "调整分镜", "补充产品素材"];
  if (capability.includes("video")) return ["调整分镜", "补充产品素材", "缩短到30秒", "换成9:16"];
  if (capability.includes("image") || capability === "cover_image" || capability === "storyboard_image") return ["换成9:16", "标题更醒目", "减少画面元素"];
  if (capability === "social_post") return ["改得更专业", "缩短到120字", "拆成60秒口播"];
  return ["生成LinkedIn文案", "拆成短视频方案", "改得更具体"];
}

function isVideoDirectorDraft(asset: ContentAsset): boolean {
  const metadata = asset.metadata ?? {};
  return asset.content_type === "video_script" && metadata.video_workflow_stage === "director_script_draft";
}

function assetLabelFromProduct(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (metadata.no_asset_hit) return "未命中素材";
  const count = Array.isArray(asset.linked_asset_ids) ? asset.linked_asset_ids.length : 0;
  return count > 0 ? `已关联 ${count} 个素材` : "模型通用知识";
}

function artifactCategory(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  const explicit = stringValue(metadata.artifact_category);
  if (explicit) return explicit;
  if (asset.content_type === "content_plan") return "选题方案";
  if (asset.content_type === "short_video_narration" || asset.content_type === "video_script") return "编导稿";
  if (asset.content_type === "social_post") return "文案稿";
  if (asset.content_type === "video_render") return "视频工程";
  return stringValue(metadata.capability_label) || contentAssetTypeLabel(asset.content_type);
}

function normalizeProductTitle(title: string): string {
  let clean = title.replace(/\s+/g, " ").trim().replace(/^[\-—–·｜|]+|[\-—–·｜|]+$/g, "");
  if (!clean) return "MultiMix";
  const suffixPattern = /\s*(?:-|—|–|·|｜|\|)\s*(?:MP4\s*成片(?:\s*v\d+)?|视频工程|编导文稿|编导稿|视频脚本|视频文案草稿|文案草稿|内容草稿|准备稿|草稿)\s*$/i;
  for (let index = 0; index < 4; index += 1) {
    const next = clean.replace(suffixPattern, "").trim().replace(/^[\-—–·｜|]+|[\-—–·｜|]+$/g, "");
    if (next === clean) break;
    clean = next;
  }
  return clean || title;
}

export function statusLabelFromProduct(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (metadata.video_project) return "视频工程";
  if (metadata.unsupported_adapter) return "可执行方案";
  if (metadata.no_asset_hit) return "通用能力生成";
  return "有来源";
}

function contentAssetTypeLabel(contentType: string): string {
  const labels: Record<string, string> = {
    content_plan: "内容方案",
    social_post: "发帖文案",
    short_video_narration: "编导稿",
    video_script: "编导稿",
    cover_image: "封面图方案",
    storyboard_image: "分镜图方案",
    video_render: "成片准备",
    digital_human_video: "数字人视频准备",
    mg_animation_video: "MG动画准备",
    real_scene_video: "实景视频准备",
    generated_video: "生成视频准备",
    image_generation: "图片方案",
    image_edit: "图片调整方案"
  };
  return labels[contentType] ?? "内容产物";
}

function productModeFromAsset(asset: ContentAsset, unsupported: boolean): AssetProductMode {
  if (unsupported) return "copy";
  if (asset.content_type === "video_script") return "copy";
  if (asset.content_type === "digital_human_video") return "digital-human";
  if (asset.asset_kind === "image") return "image";
  if (asset.asset_kind === "video" || asset.asset_kind === "video_render") return "video";
  return "copy";
}

export function hasEditorTimelineShape(project: Record<string, unknown> | undefined): boolean {
  if (!project) return false;
  const container = isRecord(project.timeline) ? project.timeline : project;
  return Array.isArray(container.tracks) && Array.isArray(container.media);
}

export function isEditorReadyVideoProject(
  asset: ContentAsset,
  project: Record<string, unknown> | undefined = isRecord(asset.metadata?.video_project)
    ? asset.metadata.video_project
    : undefined,
): boolean {
  const metadata = asset.metadata ?? {};
  return asset.content_type === "video_render"
    && asset.status === "ready"
    && metadata.orchestration_pending === false
    && metadata.video_workflow_stage === "video_project_ready"
    && hasEditorTimelineShape(project);
}

export function contentAssetToProduct(asset: ContentAsset): AssetProduct {
  const metadata = asset.metadata ?? {};
  const capability = typeof metadata.capability === "string" ? metadata.capability : asset.content_type;
  const intent = isRecord(metadata.intent) ? metadata.intent : {};
  const rawVideoProject = isRecord(metadata.video_project) ? metadata.video_project : undefined;
  const videoProject = isEditorReadyVideoProject(asset, rawVideoProject) ? rawVideoProject : undefined;
  const invalidVideoProject = Boolean(rawVideoProject && !videoProject);
  const mp4Artifact = isRecord(metadata.mp4_artifact) ? metadata.mp4_artifact : undefined;
  const videoSegments = Array.isArray(videoProject?.segments) ? videoProject.segments.filter(isRecord) : [];
  const stageResults = isRecord(videoProject?.stage_results) ? videoProject.stage_results : undefined;
  const unsupported = (Boolean(metadata.unsupported_adapter) || metadata.generation_state === "preparation_only") && !videoProject;
  const mode = productModeFromAsset(asset, unsupported);
  const body = markdownToParagraphs(asset.body);
  const sourceCount = Array.isArray(asset.linked_asset_ids) ? asset.linked_asset_ids.length : 0;
  const noAssetHit = Boolean(metadata.no_asset_hit);
  const mp4State = stringValue(videoProject?.mp4_state) || "";
  const directorDraft = isVideoDirectorDraft(asset);
  // Orchestration lifecycle: pending while the async job runs, failed when the
  // job died without producing a project (retryable from the workspace).
  const orchestrationPending = Boolean(metadata.orchestration_pending && !videoProject);
  const orchestrationFailed = Boolean(
    !videoProject
    && !orchestrationPending
    && asset.status === "failed"
    && typeof metadata.latest_job_public_id === "string"
  );
  const status = videoProject
    ? videoProjectStatusLabel(mp4State)
    : mp4Artifact
      ? "MP4 成片 · 已生成"
    : orchestrationPending
      ? "视频生成中 · 后台任务"
    : orchestrationFailed
      ? "生成失败 · 可重试"
    : invalidVideoProject
      ? "工程异常 · 待恢复"
    : unsupported
    ? "可执行方案 · 待生成"
    : directorDraft
      ? noAssetHit
        ? "未命中素材"
        : "有来源"
    : noAssetHit
      ? "未命中素材"
      : "有来源";
  const rawRatio = stringValue(videoProject?.ratio) || stringValue(mp4Artifact?.ratio) || stringValue(intent.ratio);
  const ratio = normalizeRatioLabel(rawRatio) || (mode === "copy" ? "Markdown" : "按指令");
  const duration = videoProject?.duration_seconds
    ? `${videoProject.duration_seconds}秒`
    : mp4Artifact?.duration_seconds
      ? `${mp4Artifact.duration_seconds}秒`
      : stringValue(intent.duration) || (capability.includes("video") ? "待确认" : `${body.length} 段`);
  const capabilityLabel = artifactCategory(asset);
  const sections = [
    {
      label: "能力",
      title: capabilityLabel,
      detail: mp4Artifact ? "这是视频工程的一次导出结果，原视频工程仍可继续调整。" : videoProject ? "已生成可编辑视频工程，可继续在对话中调整分镜。" : unsupported ? "当前先生成可执行方案，暂未创建真实生成任务。" : directorDraft ? "先生成可修改的编导稿，包含口播、分镜、画面建议和字幕重点；确认后再生成视频工程。" : "已根据对话生成草稿。",
      status: mp4Artifact ? "成片已生成" : videoProject ? "工程已生成" : unsupported ? "待生成" : directorDraft ? "待确认" : "已生成"
    },
    {
      label: "来源",
      title: noAssetHit ? "未命中素材" : `${sourceCount} 个素材`,
      detail: noAssetHit ? "该产物使用模型通用知识生成，不能视为素材证据支持。" : "生成 metadata 保留了素材来源映射。",
      status: noAssetHit ? "no-asset-hit" : "已关联"
    },
    {
      label: "参数",
      title: [stringValue(intent.channel), stringValue(intent.style)].filter(Boolean).join(" / ") || "按自然语言指令",
      detail: stringValue(videoProject?.render_error) || asset.error_message || "可继续通过对话调整比例、时长、风格、素材或表达方式。",
      status: mp4State === "failed" ? "成片失败" : "可调整"
    }
  ];
  if (videoProject) {
      sections.splice(1, 0, {
        label: "段落",
        title: videoSegments.length ? `${videoSegments.length} 段视频方案` : "已生成关键轨道",
        detail: "分镜、文案和素材方向已经拆好；后续会逐段配音并匹配素材。",
        status: stringValue(videoProject.segments_source) || "segments"
    });
    sections.splice(2, 0, {
      label: "编辑",
      title: mp4State === "ready" ? "已有导出文件" : mp4State === "running" ? "处理中" : "可继续调整",
      detail: mp4State === "failed" ? "工程已保留，可继续调整分镜。" : stringValue(videoProject.mp4_ref) || "可以在对话中调整分镜、字幕重点、素材方向和节奏。",
      status: mp4State || "editable"
    });
    if (stageResults) {
      sections.splice(3, 0, {
        label: "执行状态",
        title: [
          `配音 ${stringValue(stageResults.voiceover) || "pending"}`,
          `素材 ${stringValue(stageResults.material_match) || "pending"}`,
          `渲染 ${stringValue(stageResults.mp4_render) || "pending"}`
        ].join(" / "),
        detail: "执行阶段会写回 metadata，失败时保留可编辑工程和稳定失败原因。",
        status: stringValue(videoProject.latest_render_stage) || "执行状态"
      });
    }
  }
  if (mp4Artifact) {
    sections.splice(1, 0, {
      label: "来源工程",
      title: stringValue(metadata.source_video_project_title) || "视频工程",
      detail: "导出结果来自视频工程，不会覆盖工程本身。",
      status: stringValue(metadata.latest_render_job_id) || "render job"
    });
    sections.splice(2, 0, {
      label: "播放",
      title: "已有导出文件",
      detail: "播放通过后端认证接口读取，不直接暴露私有存储地址。",
      status: stringValue(mp4Artifact.mp4_state) || "ready"
    });
  }
  const segments = segmentsFromVideoMetadata(metadata);
  return {
    id: `asset-${asset.id}`,
    backendAssetId: asset.id,
    videoProjectReady: Boolean(videoProject),
    metadata,
    mode,
    title: normalizeProductTitle(asset.title),
    status,
    summary: firstMeaningfulLine(asset.body) || asset.title,
    ratio,
    duration,
    phase: capabilityLabel,
    version: asset.versions?.length ? `v${asset.versions.length}` : "v1",
    body,
    markdownBody: asset.body,
    sections,
    timeline: timelineFromVideoProject(videoProject) ?? (mode === "copy" ? [] : timelineFromBody(asset.body, unsupported)),
    actions: suggestionsForCapability(capability),
    sourceIds: asset.linked_asset_ids.map((id) => String(id)),
    segments,
    sourceSummary: sourceSummaryForAsset(asset, segments),
    versions: (asset.versions ?? []).map((version) => ({
      id: String(version.id),
      label: `v${version.version}`,
      savedAt: relativeTimeLabel(version.created_at),
      status: version.edit_intent === "restore"
        ? "恢复版本"
        : version.instruction
          ? `修订：${version.instruction}`
          : "初始版本"
    })),
    preview: {
      title: normalizeProductTitle(asset.title),
    subtitle: mp4Artifact ? "已有导出文件，可直接播放" : mp4State === "ready" ? "已有导出文件，可直接播放" : videoProject ? "视频工程已生成，可查看关键轨道并继续调整分镜" : orchestrationPending ? "视频工程正在后台生成，可切换对话，完成后自动展示" : orchestrationFailed ? (asset.error_message ? `生成失败：${asset.error_message}` : "生成失败，可重试或调整指令") : invalidVideoProject ? "工程状态不完整，已停止进入编辑器并等待恢复。" : unsupported ? "准备产物，未渲染图片或视频" : directorDraft ? "编导稿已生成，确认后可继续生成视频工程" : (noAssetHit ? "通用能力生成，未命中素材" : "后端 LLM 生成草稿"),
      eyebrow: capabilityLabel
    }
  };
}

// Convert a persisted backend conversation row into the frontend Conversation
// shape. A fallbackProduct (newly created) may be passed to keep selection stable.
export function conversationFromPersisted(
  row: AssetConversationResponse,
  newConversationProduct: AssetProduct,
  fallbackProduct?: AssetProduct
): AssetConversation {
  const products = row.products.map(contentAssetToProduct);
  const product = fallbackProduct
    ? products.find((item) => item.id === fallbackProduct.id) ?? fallbackProduct
    : products[products.length - 1] ?? newConversationProduct;
  const messages: AssetConversationMessage[] = row.messages.map((message) => ({
    role: message.role,
    text: message.text,
    presentation: confirmationMessagePresentation(message.role, message.metadata),
    assetId: message.asset_id,
    metadata: message.metadata,
    suggestions: message.role === "assistant" ? stringListValue(message.metadata.suggestions) : undefined,
    suggestionActions: message.role === "assistant" ? suggestionActionsValue(message.metadata.suggestion_actions) : undefined,
    plan: message.role === "assistant" ? planFromMetadata(message.metadata.plan) : undefined
  }));
  for (const asset of row.products) {
    const metadata = asset.metadata ?? {};
    const isPendingVideoProject = Boolean(
      metadata.orchestration_pending
      && !metadata.video_project
      && typeof metadata.latest_job_public_id === "string"
    );
    if (!isPendingVideoProject) continue;
    const existingIndex = messages.findIndex((message) => message.assetId === asset.id);
    if (existingIndex >= 0) {
      const text = messages[existingIndex].text;
      messages[existingIndex] = {
        ...messages[existingIndex],
        text: text.includes("后台生成中") ? text : `${text}\n\n视频工程正在后台生成中，切换对话后会继续运行。`,
        pending: true,
      };
      continue;
    }
    messages.push({
      role: "assistant",
      text: "视频工程正在后台生成中，切换对话后会继续运行。",
      assetId: asset.id,
      suggestions: undefined,
      pending: true
    });
  }
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.text ?? "";
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant")?.text ?? "";
  const lastAsset = row.products[row.products.length - 1];
  return {
    id: row.id,
    title: row.title || product.title,
    type: "llm-generation",
    updatedAt: relativeTimeLabel(row.updated_at),
    assetLabel: lastAsset ? assetLabelFromProduct(lastAsset) : "对话历史",
    status: lastAsset ? statusLabelFromProduct(lastAsset) : row.status,
    prompt: lastUserMessage,
    response: lastAssistantMessage,
    canvasTitle: product.title,
    canvasMeta: `${product.status} · ${product.ratio}`,
    raw: fallbackProduct?.body?.join("\n\n") ?? lastAsset?.body ?? "",
    judgment: "",
    action: "",
    delivery: lastAssistantMessage,
    suggestions: products[products.length - 1]?.actions ?? [],
    messages,
    product,
    products: fallbackProduct && !products.some((item) => item.id === fallbackProduct.id) ? [...products, fallbackProduct] : products,
    sourceIds: Array.from(new Set(row.products.flatMap((asset) => asset.linked_asset_ids.map((id) => String(id)))))
  };
}

export function mergePersistedConversations(
  rows: AssetConversationResponse[],
  current: AssetConversation[],
  newConversationProduct: AssetProduct
): AssetConversation[] {
  const persisted = rows.map((row) => conversationFromPersisted(row, newConversationProduct));
  const persistedIds = new Set(persisted.map((conversation) => conversation.id));
  return [
    ...persisted,
    ...current.filter((conversation) => !persistedIds.has(conversation.id) && conversation.id !== "new")
  ];
}
