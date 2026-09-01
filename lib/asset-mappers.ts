// Maps backend ContentAsset / AssetConversationResponse shapes into the
// frontend AssetProduct / AssetConversation contract.
// frontend assets-workspace-client.tsx helpers.

import { confirmationMessagePresentation } from "../app/assets/lib/conversation-execution-presentation";
import { normalizeAssetTitle } from "../app/assets/lib/asset-workspace-shared";
import type {
  AgentActionRunResponse,
  AgentActionStatus,
  AgentRunStep,
  AgentTaskCollection,
  AgentTaskSummary,
  AssetConversation,
  AssetConversationMessage,
  AssetMessagePlan,
  AssetPlanBgmOption,
  AssetPlanField,
  AssetPresenterDirectionOption,
  AssetPresenterVisualSystemSummary,
  AssetPresenterCleanupItem,
  AssetPresenterAudioTrackOption,
  AssetPresenterVisualEvent,
  AssetPlanRatioOption,
  AssetPlanVoiceOption,
  AssetPlanRef,
  AssetProduct,
  AssetProductMode,
  AssetProductSegment,
  AssetProductSourceRef,
  AssetProductSourceSummary,
  AssetSuggestionAction,
  AssetVisualPreviewPlan,
} from "../app/assets/lib/asset-workspace-types";
import { API_BASE, type AssetConversationResponse, type ContentAsset } from "./api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function optionalPositiveIntegerValue(value: unknown): number | null {
  return positiveIntegerValue(value) ?? null;
}

const AGENT_ACTION_STATUSES = new Set<AgentActionStatus>([
  "planned",
  "waiting_confirmation",
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "canceled",
]);

function agentActionStatusValue(value: unknown): AgentActionStatus | undefined {
  return typeof value === "string" && AGENT_ACTION_STATUSES.has(value as AgentActionStatus)
    ? value as AgentActionStatus
    : undefined;
}

function agentActionFromValue(value: unknown): AgentActionRunResponse | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const status = agentActionStatusValue(value.status);
  if (!id || !status) return undefined;
  return {
    id,
    status,
    requiresConfirmation: value.requires_confirmation === true,
    confirmationId: stringValue(value.confirmation_id) || null,
    assetId: optionalPositiveIntegerValue(value.asset_id),
    versionId: optionalPositiveIntegerValue(value.version_id),
    message: stringValue(value.message),
    retryable: value.retryable === true,
  };
}

function agentRunStepsValue(value: unknown): AgentRunStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const steps = value.flatMap((item): AgentRunStep[] => {
    if (!isRecord(item)) return [];
    const key = stringValue(item.key);
    const label = stringValue(item.label);
    const status = stringValue(item.status);
    if (
      !key
      || !label
      || !["done", "run", "wait", "fail"].includes(status)
    ) return [];
    return [{
      key,
      label,
      status: status as AgentRunStep["status"],
      elapsedLabel: stringValue(item.elapsed_label) || undefined,
    }];
  });
  return steps.length ? steps : undefined;
}

function normalizeRatioLabel(value: string): string {
  const normalized = value.replace(/：/g, ":").trim();
  const ratio = normalized.match(/\d+(?:\.\d+)?:\d+(?:\.\d+)?/);
  if (ratio) return ratio[0];
  return normalized.replace(/(?:横屏|竖屏|横版|竖版|横向|竖向|landscape|portrait)/gi, "").trim();
}

function ratioFromVideoProjectGeometry(project: Record<string, unknown> | null | undefined): string {
  if (!project) return "";
  const orchestration = isRecord(project.orchestration) ? project.orchestration : null;
  const layout = stringValue(orchestration?.layout).toLowerCase();
  if (layout === "landscape") return "16:9";
  if (layout === "portrait") return "9:16";
  if (layout === "square") return "1:1";

  const settings = isRecord(project.settings) ? project.settings : null;
  const width = numberOrUndefined(settings?.width);
  const height = numberOrUndefined(settings?.height);
  if (width == null || height == null || width <= 0 || height <= 0) return "";
  if (width === height) return "1:1";
  return width > height ? "16:9" : "9:16";
}

function durationFromVideoProjectTimeline(project: Record<string, unknown> | null | undefined): number | undefined {
  if (!project) return undefined;
  const timeline = isRecord(project.timeline) ? project.timeline : project;
  const tracks = Array.isArray(timeline.tracks) ? timeline.tracks : [];
  let latestEnd: number | undefined;
  for (const track of tracks) {
    if (!isRecord(track) || !Array.isArray(track.elements)) continue;
    for (const element of track.elements) {
      if (!isRecord(element)) continue;
      const start = numberOrUndefined(element.startTime) ?? 0;
      const duration = numberOrUndefined(element.duration);
      if (duration == null || duration < 0) continue;
      const end = start + duration;
      latestEnd = latestEnd == null ? end : Math.max(latestEnd, end);
    }
  }
  return latestEnd != null && latestEnd > 0 ? latestEnd : undefined;
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
      mode: stringValue(item.mode) || undefined,
      enabled: item.enabled !== false,
      disabledReason: stringValue(item.disabled_reason) || undefined,
      requiresConfirmation: item.requires_confirmation !== false
    }];
  });
  return actions.length ? actions : undefined;
}

function browserReadableMediaUrl(ref: string): string | undefined {
  if (!ref) return undefined;
  if (/^(?:https?:\/\/|data:|blob:)/i.test(ref)) return ref;
  if (/^[a-z0-9+.-]+:\/\//i.test(ref)) {
    const artifactPath = ref.split("://", 2)[1] ?? "";
    if (!/(?:^|\/)(?:video-orchestration|product-media|presenter-samples|presenter-previews|mg)\//i.test(artifactPath)
      && !/(?:^|\/)content-assets\/\d+\/generation-jobs\/\d+\/images\/[0-9a-f]{64}\.(?:png|jpe?g|webp)$/i.test(artifactPath)) {
      return undefined;
    }
    return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
  }
  return undefined;
}

function planThumbnailUrl(ref: string): string | undefined {
  return browserReadableMediaUrl(ref);
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

function planBgmOptionsValue(value: unknown): AssetPlanBgmOption[] {
  if (!Array.isArray(value)) return [];
  const identifiers = new Set<string>();
  return value.slice(0, 3).flatMap((item): AssetPlanBgmOption[] => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    const title = stringValue(item.title);
    const reason = stringValue(item.reason);
    const selectionMode = stringValue(item.selection_mode);
    if (
      !id
      || !title
      || !reason
      || identifiers.has(id)
      || !["semantic_structured", "stable_fallback"].includes(selectionMode)
    ) return [];
    identifiers.add(id);
    return [{
      id,
      title,
      reason,
      selectionMode: selectionMode as AssetPlanBgmOption["selectionMode"],
    }];
  });
}

function planVisualPreviewsValue(value: unknown): AssetVisualPreviewPlan | undefined {
  if (!isRecord(value) || value.schema_version !== "visual_preview_plan:v1") return undefined;
  if (!Array.isArray(value.scenes)) return undefined;
  const scenes = value.scenes.flatMap((scene): AssetVisualPreviewPlan["scenes"] => {
    if (!isRecord(scene) || !Array.isArray(scene.frames)) return [];
    const sceneId = stringValue(scene.scene_id);
    const title = stringValue(scene.title);
    const sceneIndex = positiveIntegerValue(scene.scene_index);
    if (!sceneId || !title || !sceneIndex) return [];
    const frames = scene.frames.slice(0, 4).flatMap((frame): AssetVisualPreviewPlan["scenes"][number]["frames"] => {
      if (!isRecord(frame)) return [];
      const frameId = stringValue(frame.frame_id);
      const timeRole = stringValue(frame.time_role);
      const label = stringValue(frame.label);
      const visualState = stringValue(frame.visual_state);
      const previewKind = stringValue(frame.preview_kind);
      const fidelity = stringValue(frame.fidelity);
      const sourceStatus = stringValue(frame.source_status);
      const limitation = stringValue(frame.limitation);
      if (
        !frameId
        || !["opening", "change", "closing"].includes(timeRole)
        || !label
        || !visualState
        || !["exact_asset", "public_candidate", "generation_intent"].includes(previewKind)
        || !["exact", "candidate", "schematic"].includes(fidelity)
        || !sourceStatus
        || !limitation
      ) return [];
      return [{
        frameId,
        timeRole: timeRole as "opening" | "change" | "closing",
        label,
        visualState,
        previewKind: previewKind as "exact_asset" | "public_candidate" | "generation_intent",
        fidelity: fidelity as "exact" | "candidate" | "schematic",
        sourceStatus,
        previewUrl: planThumbnailUrl(stringValue(frame.preview_url)),
        sourceAssetId: positiveIntegerValue(frame.source_asset_id),
        limitation,
      }];
    });
    if (!frames.length) return [];
    return [{ sceneId, sceneIndex, title, frames }];
  });
  if (!scenes.length) return undefined;
  return {
    schemaVersion: "visual_preview_plan:v1",
    sceneCount: positiveIntegerValue(value.scene_count) ?? scenes.length,
    scenes,
  };
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
  const voiceOptions = planVoiceOptionsValue(value.voice_options);
  const directionOptions = planDirectionOptionsValue(value.direction_options);
  const cleanupItems = planCleanupItemsValue(value.cleanup_items);
  const audioTrackOptions = planAudioTrackOptionsValue(value.audio_track_options);
  const subtitleOptions = planRatioOptionsValue(value.subtitle_options)
    .filter((option) => ["translated_zh", "source", "bilingual"].includes(option.value)) as AssetMessagePlan["subtitleOptions"];
  const subtitleDefault = stringValue(value.subtitle_default);
  const visualPreviews = planVisualPreviewsValue(value.visual_previews);
  const bgmOptions = planBgmOptionsValue(value.bgm_options);
  const planKind = stringValue(value.kind);
  return {
    kind: planKind === "video_parameter_confirmation"
      || planKind === "video_project_confirmation"
      || planKind === "presenter_audio_selection_confirmation"
      || planKind === "presenter_cleanup_confirmation"
      || planKind === "presenter_project_confirmation"
      || planKind === "agent_action_confirmation"
      ? planKind
      : undefined,
    title,
    status,
    subtitle: stringValue(value.subtitle) || undefined,
    fields,
    summaryFields: summaryFields.length ? summaryFields : undefined,
    confirmLabel: stringValue(value.confirm_label) || undefined,
    adjustLabel: stringValue(value.adjust_label) || undefined,
    confirmUtterance: stringValue(value.confirm_utterance) || undefined,
    ratioOptions: ratioOptions.length ? ratioOptions : undefined,
    ratioDefault: stringValue(value.ratio_default) || undefined,
    ratioConfirmationRequired: value.ratio_confirmation_required === true,
    voiceOptions: voiceOptions.length ? voiceOptions : undefined,
    voiceDefault: typeof value.voice_default === "boolean" ? value.voice_default : undefined,
    ttsAvailable: typeof value.tts_available === "boolean" ? value.tts_available : undefined,
    voiceBlockedUntilDisabled: value.voice_blocked_until_disabled === true,
    recommendationMode: value.recommendation_mode === "single_winner"
      ? "single_winner"
      : undefined,
    durationSeconds: positiveIntegerValue(value.duration_seconds),
    durationMin: positiveIntegerValue(value.duration_min),
    durationMax: positiveIntegerValue(value.duration_max),
    pendingIntentId: stringValue(value.pending_intent_id) || undefined,
    pendingIntentVersion: positiveIntegerValue(value.pending_intent_version),
    confirmationId: stringValue(value.confirmation_id) || undefined,
    directionOptions: directionOptions.length ? directionOptions : undefined,
    directionDefault: stringValue(value.direction_default) || undefined,
    cleanupPlanId: stringValue(value.cleanup_plan_id) || undefined,
    cleanupPlanHash: stringValue(value.cleanup_plan_hash) || undefined,
    cleanupItems: cleanupItems.length ? cleanupItems : undefined,
    requiresClarification: value.requires_clarification === true,
    audioTrackOptions: audioTrackOptions.length ? audioTrackOptions : undefined,
    audioTrackDefault: typeof value.audio_track_default === "number"
      ? value.audio_track_default
      : undefined,
    subtitleOptions: subtitleOptions?.length ? subtitleOptions : undefined,
    subtitleDefault: subtitleDefault === "translated_zh" || subtitleDefault === "source" || subtitleDefault === "bilingual"
      ? subtitleDefault
      : undefined,
    visualPreviews,
    bgmCatalogVersion: stringValue(value.bgm_catalog_version) || undefined,
    bgmOptions: bgmOptions.length ? bgmOptions : undefined,
    bgmDefault: stringValue(value.bgm_default) || undefined,
    bgmEnabledDefault: typeof value.bgm_enabled_default === "boolean"
      ? value.bgm_enabled_default
      : undefined,
  };
}

function planCleanupItemsValue(value: unknown): AssetPresenterCleanupItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AssetPresenterCleanupItem[] => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    const state = stringValue(item.state);
    if (!id || !["auto", "suggested", "protected"].includes(state)) return [];
    const semanticReviewValue = isRecord(item.semantic_review) ? item.semantic_review : undefined;
    const semanticVerdict = stringValue(semanticReviewValue?.verdict);
    const semanticReason = stringValue(semanticReviewValue?.reason);
    const semanticReview = ["approve", "downgrade", "protect"].includes(semanticVerdict)
      && semanticReason
      ? {
          verdict: semanticVerdict as "approve" | "downgrade" | "protect",
          reason: semanticReason,
        }
      : undefined;
    const secondaryValue = isRecord(item.secondary_recognition) ? item.secondary_recognition : undefined;
    const secondaryStatus = stringValue(secondaryValue?.status);
    const secondaryLabel = stringValue(secondaryValue?.label);
    const secondaryRecognition = ["confirmed", "disagreed", "invalid", "unavailable"].includes(secondaryStatus)
      && secondaryLabel
      ? {
          status: secondaryStatus as "confirmed" | "disagreed" | "invalid" | "unavailable",
          label: secondaryLabel,
          model: stringValue(secondaryValue?.model) || undefined,
        }
      : undefined;
    return [{
      id,
      state: state as AssetPresenterCleanupItem["state"],
      category: stringValue(item.category),
      spokenText: stringValue(item.spoken_text),
      action: stringValue(item.action),
      reason: stringValue(item.reason),
      decisionLabel: stringValue(item.decision_label),
      decisionReason: stringValue(item.decision_reason),
      semanticReview,
      secondaryRecognition,
      estimatedSavingSeconds: typeof item.estimated_saving_seconds === "number"
        ? item.estimated_saving_seconds
        : 0,
      risk: stringValue(item.risk),
      audioRisk: stringValue(item.audio_risk),
      visualJumpRisk: stringValue(item.visual_jump_risk),
      protectionReasons: Array.isArray(item.protection_reasons)
        ? item.protection_reasons.map(stringValue).filter(Boolean)
        : [],
      selected: item.selected === true,
      locked: item.locked === true,
    }];
  });
}

function planAudioTrackOptionsValue(value: unknown): AssetPresenterAudioTrackOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AssetPresenterAudioTrackOption[] => {
    if (!isRecord(item) || typeof item.stream_index !== "number") return [];
    return [{
      streamIndex: item.stream_index,
      label: stringValue(item.label) || `人声轨 ${item.stream_index}`,
      previewUrl: planThumbnailUrl(stringValue(item.preview_url)) ?? "",
      qualityScore: typeof item.quality_score === "number" ? item.quality_score : 0,
      recommended: item.recommended === true,
      channels: typeof item.channels === "number" ? item.channels : 0,
      codec: stringValue(item.codec),
      audioFingerprint: stringValue(item.audio_fingerprint) || undefined,
      transcriptHash: stringValue(item.transcript_hash) || undefined,
    }];
  });
}

function planDirectionOptionsValue(value: unknown): AssetPresenterDirectionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AssetPresenterDirectionOption[] => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.id);
    const label = stringValue(item.label);
    const concept = stringValue(item.concept);
    const reason = stringValue(item.reason);
    const sampleUrl = planThumbnailUrl(stringValue(item.sample_url));
    const durationSeconds = typeof item.duration_seconds === "number" && Number.isFinite(item.duration_seconds)
      ? item.duration_seconds
      : undefined;
    if (!id || !label || !concept || !reason || !sampleUrl || !durationSeconds || durationSeconds <= 0) return [];
    const visualSystem = presenterVisualSystemSummaryValue(item.visual_system);
    return [{
      id,
      label,
      concept,
      reason,
      recommended: item.recommended === true,
      sampleUrl,
      durationSeconds,
      ...(visualSystem ? { visualSystem } : {}),
    }];
  });
}

function presenterVisualSystemSummaryValue(value: unknown): AssetPresenterVisualSystemSummary | undefined {
  if (!isRecord(value)) return undefined;
  const stylePackRef = stringValue(value.style_pack_ref);
  const label = stringValue(value.label);
  const motionIntensity = stringValue(value.motion_intensity);
  const motionLabel = stringValue(value.motion_label);
  if (
    !stylePackRef
    || !label
    || !motionLabel
    || !["restrained", "balanced", "dynamic"].includes(motionIntensity)
  ) return undefined;
  return {
    stylePackRef,
    label,
    motionIntensity: motionIntensity as AssetPresenterVisualSystemSummary["motionIntensity"],
    motionLabel,
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

function planVoiceOptionsValue(value: unknown): AssetPlanVoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AssetPlanVoiceOption[] => {
    if (!isRecord(item) || typeof item.value !== "boolean") return [];
    const label = stringValue(item.label);
    if (!label) return [];
    return [{ value: item.value, label }];
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
  return browserReadableMediaUrl(ref);
}

function imageThumbnailUrlFromRef(ref: string): string | undefined {
  const normalized = ref.split("?", 1)[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm|mov|m4v)$/.test(normalized)) return undefined;
  return thumbnailUrlFromRef(ref);
}

type SegmentTiming = { start: number; end: number };

type PrimaryVisualSourceType = "saved_asset" | "public_asset" | "product_asset" | "generated_scene";
type MaterialFillStatus = "saved_hit" | "public_candidate" | "unfilled";
type PrimaryVisualTreatment = "material_primary" | "material_enhanced" | "graphics_primary";

function primaryVisualSourceType(value: unknown): PrimaryVisualSourceType | undefined {
  return value === "saved_asset" || value === "public_asset" || value === "product_asset" || value === "generated_scene"
    ? value
    : undefined;
}

function primaryVisualTreatment(value: unknown): PrimaryVisualTreatment | undefined {
  return value === "material_primary" || value === "material_enhanced" || value === "graphics_primary"
    ? value
    : undefined;
}

function materialFillStatus(value: unknown): MaterialFillStatus | undefined {
  return value === "saved_hit" || value === "public_candidate" || value === "unfilled"
    ? value
    : undefined;
}

function primaryVisualMediaType(
  ref: string,
  sourceType: PrimaryVisualSourceType | undefined,
): "image" | "video" | undefined {
  const normalized = ref.split("?", 1)[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm|mov|m4v)$/.test(normalized)) return "video";
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(normalized)) return "image";
  return sourceType === "generated_scene" ? "video" : undefined;
}

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

const PRESENTER_EVENT_LABELS: Record<AssetPresenterVisualEvent["type"], AssetPresenterVisualEvent["label"]> = {
  text_emphasis: "文字强调",
  media_overlay: "画中画",
  graphic_overlay: "图形说明",
  media_takeover: "全屏素材",
  presenter_reframe: "人物让位",
};

const PRESENTER_EVENT_STATUS_LABELS: Record<string, AssetPresenterVisualEvent["statusLabel"]> = {
  planned: "待生成",
  rendering: "生成中",
  rendered: "已完成",
  failed: "生成失败",
  stale: "待更新",
};

function presenterSpokenText(
  event: Record<string, unknown>,
  words: Record<string, unknown>[],
  wordPositions: Map<string, number>,
): string | undefined {
  const start = wordPositions.get(stringValue(event.start_word_id));
  const end = wordPositions.get(stringValue(event.end_word_id));
  if (start == null || end == null || end < start) return undefined;
  let text = "";
  for (const word of words.slice(start, end + 1)) {
    const token = stringValue(word.text);
    if (!token) continue;
    if (
      text
      && /[A-Za-z0-9]$/.test(text)
      && /^[A-Za-z0-9]/.test(token)
    ) text += " ";
    text += token;
  }
  return text || undefined;
}

function presenterEventsFromScene(
  scene: Record<string, unknown> | undefined,
  words: Record<string, unknown>[],
  wordPositions: Map<string, number>,
): AssetPresenterVisualEvent[] | undefined {
  const rawEvents = Array.isArray(scene?.visual_events) ? scene.visual_events.filter(isRecord) : [];
  const events = rawEvents.flatMap((event) => {
    const type = stringValue(event.type) as AssetPresenterVisualEvent["type"];
    const label = PRESENTER_EVENT_LABELS[type];
    const id = stringValue(event.event_id);
    if (!label || !id) return [];
    const status = stringValue(event.status);
    return [{
      id,
      type,
      label,
      spokenText: presenterSpokenText(event, words, wordPositions),
      purpose: stringValue(event.purpose) || undefined,
      statusLabel: PRESENTER_EVENT_STATUS_LABELS[status] || "待生成",
      requiredForPublish: event.required_for_publish === true,
      ...(status === "failed" && stringValue(event.last_error)
        ? { failureReason: stringValue(event.last_error) }
        : {}),
      ...(status === "failed" && event.retryable === true ? { retryable: true } : {}),
    } satisfies AssetPresenterVisualEvent];
  });
  return events.length ? events : undefined;
}

// Storyboard summary for the segment cards. Reads the semantic layer in
// priority order: video_project.segments → video_segments → video_plan.scenes.
// asset_reference / mg_decision are authoritative; stock is fallback only.
function segmentsFromVideoMetadata(metadata: Record<string, unknown>): AssetProductSegment[] | undefined {
  const videoProject = isRecord(metadata.video_project) ? metadata.video_project : undefined;
  const projectTimings = segmentTimingsFromProject(videoProject);
  const videoPlan = isRecord(metadata.video_plan) ? metadata.video_plan : undefined;
  const planScenes = Array.isArray(videoPlan?.scenes) ? videoPlan.scenes.filter(isRecord) : [];
  const planScenesById = new Map(
    planScenes.map((scene) => [stringValue(scene.id), scene] as const).filter(([id]) => id),
  );
  const isPresenter = stringValue(videoPlan?.video_type) === "presenter";
  const transcript = isRecord(videoPlan?.transcript) ? videoPlan.transcript : undefined;
  const presenterWords = Array.isArray(transcript?.words) ? transcript.words.filter(isRecord) : [];
  const presenterWordPositions = new Map(
    presenterWords
      .map((word, index) => [stringValue(word.id), index] as const)
      .filter(([id]) => id),
  );
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
    const planScene = planScenesById.get(stringValue(segment.id));
    const reference = isRecord(segment.asset_reference) ? segment.asset_reference : null;
    const snapshot = reference && isRecord(reference.source_snapshot) ? reference.source_snapshot : null;
    const decision = isRecord(segment.mg_decision) ? segment.mg_decision : null;
    const visible = decision && isRecord(decision.visible_summary) ? decision.visible_summary : null;
    const primaryVisual = isRecord(segment.primary_visual)
      ? segment.primary_visual
      : isRecord(planScene?.primary_visual)
        ? planScene.primary_visual
        : null;
    const primaryStrategy = isRecord(segment.primary_visual_strategy)
      ? segment.primary_visual_strategy
      : isRecord(planScene?.primary_visual_strategy)
        ? planScene.primary_visual_strategy
        : null;
    const replacement = isRecord(segment.public_candidate_replacement)
      ? segment.public_candidate_replacement
      : isRecord(planScene?.public_candidate_replacement)
        ? planScene.public_candidate_replacement
        : null;
    const materialResolution = isRecord(segment.material_resolution)
      ? segment.material_resolution
      : isRecord(planScene?.material_resolution)
        ? planScene.material_resolution
        : null;
    const fillStatus = materialFillStatus(materialResolution?.fill_status);
    const voice = isRecord(segment.voice)
      ? segment.voice
      : isRecord(planScene?.voice)
        ? planScene.voice
        : null;
    const primarySourceType = primaryVisualSourceType(primaryVisual?.source_type);
    const primaryTreatment = primaryVisualTreatment(primaryStrategy?.visual_treatment);
    const primaryPersisted = stringValue(primaryVisual?.status) === "persisted";
    const primaryArtifactRef = stringValue(primaryVisual?.preview_ref) || stringValue(primaryVisual?.artifact_ref);
    const primaryMediaType = primaryVisualMediaType(primaryArtifactRef, primarySourceType);
    const primaryPosterRef = stringValue(primaryVisual?.poster_ref) || stringValue(primaryVisual?.thumbnail_ref);
    const primaryThumbnailUrl = primaryPersisted
      ? primaryMediaType === "video"
        ? imageThumbnailUrlFromRef(primaryPosterRef)
        : imageThumbnailUrlFromRef(primaryArtifactRef)
      : undefined;
    const generatedPrimaryAvailable = primaryPersisted
      && primarySourceType === "generated_scene"
      && Boolean(primaryArtifactRef);
    const productPrimaryAvailable = primaryPersisted
      && primarySourceType === "product_asset"
      && Boolean(primaryArtifactRef);
    const projectTiming = projectTimings.get(stringValue(segment.id));
    const start = projectTiming?.start ?? numberOrUndefined(segment.startTime) ?? numberOrUndefined(segment.start_seconds);
    const duration = numberOrUndefined(segment.duration) ?? numberOrUndefined(segment.duration_seconds);
    const end = projectTiming?.end ?? numberOrUndefined(segment.endTime) ?? (start != null && duration != null ? start + duration : undefined);
    const presenterScene = planScene ?? segment;
    const materialGap = isRecord(presenterScene.material_gap) ? presenterScene.material_gap : undefined;
    return {
      id: stringValue(segment.id) || `segment-${index + 1}`,
      index: index + 1,
      title: stringValue(segment.title) || undefined,
      startSeconds: start,
      endSeconds: end,
      line: stringValue(segment.narration) || stringValue(segment.line) || undefined,
      voiceName: stringValue(voice?.name) || undefined,
      subLine: decision?.needed === true && stringValue(decision.status) === "failed"
        ? [
            stringValue(segment.subtitle_focus) || stringValue(segment.subtitle),
            "MG 渲染失败，原分镜仍保留",
          ].filter(Boolean).join(" · ")
        : stringValue(segment.subtitle_focus) || stringValue(segment.subtitle) || undefined,
      assetTitle: stringValue(snapshot?.title) || undefined,
      assetThumbnailUrl: primaryThumbnailUrl || (primaryMediaType === "video" ? undefined : imageThumbnailUrlFromRef(
        stringValue(snapshot?.preview_url) || stringValue(snapshot?.thumbnail_url) || stringValue(snapshot?.original_ref)
      )),
      isFallback: primarySourceType === "public_asset"
        || fillStatus === "public_candidate",
      materialFillStatus: fillStatus,
      primaryVisualSourceType: primarySourceType,
      primaryVisualPersisted: primaryPersisted || undefined,
      primaryVisualMediaType: primaryPersisted
        ? primaryMediaType
        : undefined,
      visualStatusLabel: generatedPrimaryAvailable
        ? "已生成画面"
        : productPrimaryAvailable
          ? "产品界面"
          : undefined,
      businessHint: stringValue(primaryStrategy?.business_hint) === "missing_real_case_material"
        ? "建议补充真实案例素材"
        : undefined,
      mgLabel: decision?.needed === true
        ? stringValue(visible?.label) || stringValue(decision.chosen_template) || "MG"
        : undefined,
      mgStatus: decision?.needed === true ? stringValue(decision.status) || undefined : undefined,
      primaryVisualTreatment: primaryTreatment,
      visualTreatmentLabel: visualTreatmentLabel(primaryTreatment),
      selectionReason: stringValue(primaryStrategy?.selection_reason) || undefined,
      graphicComponentLabel: graphicComponentLabel(primaryStrategy?.graphic_component),
      backgroundTreatmentLabel: stringValue(primaryStrategy?.background_policy) === "verified_material_blur"
        ? "已验证素材虚化背景"
        : undefined,
      publicReplacementNote: stringValue(replacement?.reason_code) === "remote_file_missing"
        ? "原公开素材已失效，已透明替换为可用素材"
        : undefined,
      isPresenter: isPresenter || undefined,
      presenterEvents: isPresenter
        ? presenterEventsFromScene(presenterScene, presenterWords, presenterWordPositions)
        : undefined,
      presenterMaterialGap: isPresenter
        ? stringValue(materialGap?.message) || undefined
        : undefined,
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
      thumbnailUrl: imageThumbnailUrlFromRef(stringValue(item.preview_url) || stringValue(item.thumbnail_url)),
      isFallback: stringValue(item.source_type) === "public_source" || undefined
    }];
  });
  if (segments?.length) {
    const saved = segments.filter((segment) => (
      segment.materialFillStatus === "saved_hit"
      || (segment.assetTitle && !segment.isFallback)
    )).length;
    const publicUsed = segments.filter((segment) => (
      segment.primaryVisualPersisted === true
      && segment.primaryVisualSourceType === "public_asset"
    )).length;
    const publicCandidates = segments.filter((segment) => (
      segment.materialFillStatus === "public_candidate"
      && !(segment.primaryVisualPersisted === true && segment.primaryVisualSourceType === "public_asset")
    )).length;
    if (saved || publicUsed || publicCandidates) {
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
      const usedParts = [
        saved ? `${saved} 个已保存素材` : "",
        publicUsed ? `${publicUsed} 个公共素材` : ""
      ].filter(Boolean);
      const headline = usedParts.length
        ? `基于 ${usedParts.join(" + ")}生成${publicCandidates ? ` · ${publicCandidates} 个公共素材候选` : ""}`
        : `已找到 ${publicCandidates} 个公共素材候选`;
      return {
        headline,
        note: [
          saved ? `已保存素材命中 ${saved}/${segments.length}` : "",
          publicUsed ? "公共素材已验证并用于工程" : "",
          publicCandidates ? "公共素材候选待验证" : "",
        ].filter(Boolean).join(" · "),
        refs
      };
    }
  }
  if (!refs.length) return undefined;
  return { headline: `基于 ${refs.length} 个素材生成`, refs };
}

function visualTreatmentLabel(value: unknown): AssetProductSegment["visualTreatmentLabel"] {
  if (value === "material_primary") return "素材";
  if (value === "material_enhanced") return "素材加图形 / 素材处理";
  if (value === "graphics_primary") return "图形主画面";
  return undefined;
}

function graphicComponentLabel(value: unknown): string | undefined {
  return ({
    material_backdrop: "素材背景",
    process_flow: "流程图",
    classification_cards: "分类卡",
    quadrant_grid: "四象限",
    relationship_network: "关系图",
    brand_end_card: "品牌收尾页",
  } as Record<string, string>)[stringValue(value)];
}

type ProductLifecycleStatus = "generating" | "completed" | "failed";

function productLifecycleFromAsset(
  asset: ContentAsset,
): {
  status: ProductLifecycleStatus;
  failureReason?: string;
  failureAction?: "retry" | "modify_script" | "replace_scene_asset";
  failureSceneId?: string;
  operationStatus?: ProductLifecycleStatus;
  operationFailureReason?: string;
  operationFailureAction?: "retry" | "modify_script" | "replace_scene_asset";
  operationFailureSceneId?: string;
} | undefined {
  const isVideo = asset.content_type === "video_project";
  const isDirector = isVideoDirectorDraft(asset);
  const isGeneratedImage = asset.asset_kind === "image"
    && (asset.product_status === "generating"
      || asset.product_status === "completed"
      || asset.product_status === "failed");
  if (!isVideo && !isDirector && !isGeneratedImage) return undefined;
  if (isDirector) return { status: "completed" };
  const status = asset.product_status;
  if (status !== "generating" && status !== "completed" && status !== "failed") return undefined;
  return {
    status,
    failureReason: asset.failure_reason || undefined,
    failureAction: asset.failure_action || undefined,
    failureSceneId: asset.failure_scene_id || undefined,
    operationStatus: asset.operation_status || undefined,
    operationFailureReason: asset.operation_failure_reason || undefined,
    operationFailureAction: asset.operation_failure_action || undefined,
    operationFailureSceneId: asset.operation_failure_scene_id || undefined,
  };
}

function productStatusLabel(status: ProductLifecycleStatus | undefined): string | undefined {
  if (status === "generating") return "生成中";
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  return undefined;
}

// Human-readable label for the public video workflow stage.
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
    invalid_spec: "动效参数无效",
    asset_driven_planning: "正在准备分镜画面",
    planning_assets: "正在准备素材",
    asset_manifest_ready: "正在准备素材",
    composing: "正在生成视频",
    voice: "正在生成视频",
    project: "正在生成视频",
    rendering: "正在生成视频",
    reviewing: "正在完成质量检查",
    quality: "正在完成质量检查",
    needs_script_revision: "需要调整编导脚本"
  };
  return labels[stage] ?? "正在生成";
}

export function videoJobStepIndex(stage: string): number {
  if (stage === "queued" || stage === "script") return 0;
  if (stage === "segment" || stage === "render") return 1;
  if (stage === "done") return 3;
  return 2;
}

export type AgentTimelineStep = AgentRunStep;

// Backend semantic step (spec §5.2 ★): product copy plus an optional public
// retry handle. Raw timing never crosses the user API boundary.
export type VideoJobBackendStep = {
  key: string;
  label: string;
  status: string;
  elapsedLabel?: string | null;
  retryJobId?: string | null;
};

const SAFE_BACKEND_STEP_COPY: Record<string, { key: string; label: string }> = {
  create_job: { key: "create_job", label: "创建视频工程任务" },
  prepare_scenes: { key: "prepare_scenes", label: "读取已确认方案并准备分镜" },
  prepare_media: { key: "prepare_media", label: "匹配分镜素材并准备配音、字幕" },
  build_project: { key: "build_project", label: "组装可编辑视频工程" },
  mg_overlay: { key: "mg_overlay", label: "生成画面动效" },
  understand: { key: "prepare_scenes", label: "正在准备分镜画面" },
  plan: { key: "prepare_media", label: "正在准备分镜画面" },
  generate: { key: "build_project", label: "正在生成视频" },
  asset_driven_planning: { key: "prepare_scenes", label: "正在准备分镜画面" },
  planning_assets: { key: "prepare_media", label: "正在准备素材" },
  asset_manifest_ready: { key: "prepare_media", label: "正在准备素材" },
  composing: { key: "build_project", label: "正在生成视频" },
  voice: { key: "build_project", label: "正在生成视频" },
  project: { key: "build_project", label: "正在生成视频" },
  rendering: { key: "build_project", label: "正在生成视频" },
  reviewing: { key: "quality_check", label: "正在完成质量检查" },
  quality: { key: "quality_check", label: "正在完成质量检查" },
  needs_script_revision: { key: "revise_director_script", label: "需要调整编导脚本" },
};

// Steps come directly from the public job DTO; callers never infer progress
// from the historical raw render stage.
export function agentTimelineStepsFromBackend(steps: VideoJobBackendStep[] | undefined | null): AgentTimelineStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step): AgentTimelineStep[] => {
    const rawKey = typeof step.key === "string" ? step.key.trim() : "";
    if (!rawKey) return [];
    const safe = SAFE_BACKEND_STEP_COPY[rawKey] ?? {
      key: "video_progress",
      label: "正在处理视频",
    };
    const status: AgentTimelineStep["status"] =
      step.status === "done" || step.status === "run" || step.status === "fail" ? step.status : "wait";
    const retryJobId = typeof step.retryJobId === "string" ? step.retryJobId : undefined;
    return [{
      key: safe.key,
      label: safe.label,
      status,
      elapsedLabel: stringValue(step.elapsedLabel) || undefined,
      retryJobId,
    }];
  });
}


function suggestionsForCapability(capability: string, videoType = ""): string[] {
  if (videoType === "presenter") return ["调整口播包装", "修正字幕", "补充事件素材", "取消包装"];
  if (capability === "long_form_candidate_set") return ["再给我更多候选", "只看指定主题", "调整时长或比例"];
  if (capability === "video_script") return ["确认，生成视频工程", "语气更口语", "缩短到30秒", "调整分镜", "补充产品素材"];
  if (capability.includes("video")) return ["调整分镜", "补充产品素材", "缩短到30秒", "换成9:16"];
  if (capability.includes("image") || capability === "cover_image" || capability === "storyboard_image") return ["换成9:16", "标题更醒目", "减少画面元素"];
  if (capability === "social_post") return ["改得更专业", "缩短到120字", "拆成60秒口播"];
  return ["生成LinkedIn文案", "拆成短视频方案", "改得更具体"];
}

function isVideoDirectorDraft(asset: ContentAsset): boolean {
  return asset.content_type === "video_script" || asset.content_type === "short_video_narration";
}

function isMalformedDirectorDraft(asset: ContentAsset): boolean {
  const metadata = asset.metadata ?? {};
  return !isVideoDirectorDraft(asset)
    && metadata.video_workflow_stage === "director_script_draft";
}

function assetLabelFromProduct(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (metadata.template_mode === true || metadata.grounding_status === "keyword_template") return "关键词模板";
  if (metadata.no_asset_hit) return "未命中素材";
  const count = Array.isArray(asset.linked_asset_ids) ? asset.linked_asset_ids.length : 0;
  return count > 0 ? `已关联 ${count} 个素材` : "模型通用知识";
}

function artifactCategory(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (asset.content_type === "video_project") return "视频";
  if (asset.content_type === "long_form_candidate_set") return "拆条候选";
  const explicit = stringValue(metadata.artifact_category);
  if (explicit) return explicit;
  if (asset.content_type === "content_plan") return "选题方案";
  if (asset.content_type === "short_video_narration" || asset.content_type === "video_script") return "编导脚本";
  if (asset.content_type === "social_post") return "文案稿";
  if (asset.content_type === "video_project") return "视频";
  return stringValue(metadata.capability_label) || contentAssetTypeLabel(asset.content_type);
}

export function statusLabelFromProduct(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (metadata.video_project) return "视频";
  if (asset.generation_state === "preparation_only") return "可执行方案";
  if (metadata.template_mode === true || metadata.grounding_status === "keyword_template") return "关键词模板";
  if (metadata.no_asset_hit) return "通用能力生成";
  return "有来源";
}

function contentAssetTypeLabel(contentType: string): string {
  const labels: Record<string, string> = {
    content_plan: "内容方案",
    social_post: "发帖文案",
    short_video_narration: "编导脚本",
    video_script: "编导脚本",
    cover_image: "封面图方案",
    storyboard_image: "分镜图方案",
    video_project: "视频",
    mg_overlay: "MG 动效叠层",
    image_generation: "图片方案",
    image_edit: "图片调整方案",
    long_form_candidate_set: "拆条候选"
  };
  return labels[contentType] ?? "内容产物";
}

function productModeFromAsset(asset: ContentAsset, unsupported: boolean): AssetProductMode {
  if (unsupported) return "copy";
  if (isVideoDirectorDraft(asset)) return "copy";
  if (asset.content_type === "mg_overlay") return "mg-overlay";
  if (asset.asset_kind === "image") return "image";
  if (asset.asset_kind === "video") return "video";
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
  return asset.content_type === "video_project"
    && asset.status === "ready"
    && metadata.orchestration_pending === false
    && metadata.video_workflow_stage === "video_project_ready"
    && hasEditorTimelineShape(project);
}

export function contentAssetToProduct(asset: ContentAsset): AssetProduct {
  const metadata = asset.metadata ?? {};
  const rawVideoPlan = isRecord(metadata.video_plan) ? metadata.video_plan : undefined;
  const capability = asset.content_type;
  const intent = isRecord(metadata.intent) ? metadata.intent : {};
  const rawVideoProject = isRecord(metadata.video_project) ? metadata.video_project : undefined;
  const lifecycle = productLifecycleFromAsset(asset);
  const videoProject = isEditorReadyVideoProject(asset, rawVideoProject) ? rawVideoProject : undefined;
  const mp4Artifact = isRecord(metadata.mp4_artifact) ? metadata.mp4_artifact : undefined;
  const renderedImagePreviewUrl = asset.asset_kind === "image"
    ? imageThumbnailUrlFromRef(stringValue(asset.original_ref))
    : undefined;
  const productMetadata = renderedImagePreviewUrl
    ? { ...metadata, preview_url: renderedImagePreviewUrl }
    : metadata;
  const videoSegments = Array.isArray(videoProject?.segments) ? videoProject.segments.filter(isRecord) : [];
  const unsupported = asset.generation_state === "preparation_only" && !videoProject;
  const mode = productModeFromAsset(asset, unsupported);
  const body = markdownToParagraphs(asset.body);
  const sourceCount = Array.isArray(asset.linked_asset_ids) ? asset.linked_asset_ids.length : 0;
  const noAssetHit = Boolean(metadata.no_asset_hit);
  const templateMode = metadata.template_mode === true || metadata.grounding_status === "keyword_template";
  const mp4State = stringValue(videoProject?.mp4_state) || "";
  const directorDraft = isVideoDirectorDraft(asset);
  const completedGeneratedImage = asset.asset_kind === "image"
    && lifecycle?.status === "completed";
  const generatingImage = asset.asset_kind === "image"
    && lifecycle?.status === "generating";
  // Orchestration lifecycle: pending while the async job runs, failed when the
  // job died without producing a project (retryable from the workspace).
  const orchestrationFailed = lifecycle?.status === "failed";
  const orchestrationPending = lifecycle?.status === "generating";
  const invalidVideoProject = Boolean(rawVideoProject && lifecycle?.status === "failed" && !videoProject) || Boolean(
    asset.content_type === "video_project"
    && !rawVideoProject
    && !mp4Artifact
    && !orchestrationPending
    && !orchestrationFailed
  );
  const status = asset.content_type === "video_project"
    ? productStatusLabel(lifecycle?.status) ?? "生成中"
    : (productStatusLabel(lifecycle?.status) ?? (orchestrationFailed
      ? "生成失败 · 可重试"
    : orchestrationPending
      ? "视频生成中 · 后台任务"
    : invalidVideoProject
      ? "工程异常 · 待恢复"
    : asset.content_type === "long_form_candidate_set"
      ? `${Array.isArray(metadata.top_candidate_ids) ? metadata.top_candidate_ids.length : 0} 条优先候选`
    : unsupported
    ? "可执行方案 · 待生成"
    : templateMode
      ? "关键词模板"
    : directorDraft
      ? noAssetHit
        ? "未命中素材"
        : "有来源"
    : noAssetHit
      ? "未命中素材"
      : "有来源"));
  const rawRatio = stringValue(videoProject?.ratio)
    || stringValue(mp4Artifact?.ratio)
    || stringValue(intent.ratio)
    || ratioFromVideoProjectGeometry(videoProject);
  const ratio = normalizeRatioLabel(rawRatio) || (mode === "copy" ? "Markdown" : "按指令");
  const timelineDurationSeconds = durationFromVideoProjectTimeline(videoProject);
  const duration = videoProject?.duration_seconds
    ? `${videoProject.duration_seconds}秒`
    : mp4Artifact?.duration_seconds
      ? `${mp4Artifact.duration_seconds}秒`
      : stringValue(intent.duration)
        || (timelineDurationSeconds ? `${timelineDurationSeconds}秒` : "")
        || (capability.includes("video") ? "待确认" : `${body.length} 段`);
  const capabilityLabel = artifactCategory(asset);
  const sections = [
    {
      label: "能力",
      title: capabilityLabel,
      detail: mp4Artifact ? "这是视频的一次导出结果，原视频仍可继续调整。" : videoProject ? "视频已完成，可继续在对话中调整分镜。" : completedGeneratedImage ? "图片已生成并保存到图片素材库，可用于视频封面或继续调整。" : generatingImage ? "图片正在生成，完成后会自动显示真实图片。" : unsupported ? "当前先生成可执行方案，暂未创建真实生成任务。" : directorDraft ? "编导脚本已完成，包含口播、分镜、画面建议和字幕重点；确认后再生成视频。" : "已根据对话生成草稿。",
      status: productStatusLabel(lifecycle?.status) ?? (mp4Artifact ? "完成" : videoProject ? "完成" : unsupported ? "生成中" : directorDraft ? "完成" : "完成")
    },
    {
      label: "来源",
      title: templateMode ? "待补充资料" : noAssetHit ? "未命中素材" : `${sourceCount} 个素材`,
      detail: templateMode
        ? "当前内容只按用户关键词生成，可继续补充真实服务、案例或数据。"
        : noAssetHit
          ? "该产物使用模型通用知识生成，不能视为素材证据支持。"
          : "生成 metadata 保留了素材来源映射。",
      status: templateMode ? "keyword-template" : noAssetHit ? "no-asset-hit" : "已关联"
    },
    {
      label: "参数",
      title: [stringValue(intent.channel), stringValue(intent.style)].filter(Boolean).join(" / ") || "按自然语言指令",
      detail: lifecycle?.failureReason || asset.error_message || "可继续通过对话调整比例、时长、风格、素材或表达方式。",
      status: lifecycle?.status === "failed" ? "失败" : "可调整"
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
  }
  if (mp4Artifact) {
    sections.splice(1, 0, {
      label: "来源工程",
      title: stringValue(metadata.source_video_project_title) || "视频工程",
      detail: "导出结果来自视频工程，不会覆盖工程本身。",
      status: stringValue(mp4Artifact.mp4_state) || "ready"
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
    contentType: asset.content_type,
    contentHash: asset.content_hash,
    videoProjectReady: Boolean(videoProject),
    videoProductCompleted: asset.product_completed === true,
    metadata: productMetadata,
    mode,
    title: normalizeAssetTitle(asset.title),
    status,
    productStatus: lifecycle?.status,
    failureReason: lifecycle?.failureReason,
    failureAction: lifecycle?.failureAction,
    failureSceneId: lifecycle?.failureSceneId,
    operationStatus: lifecycle?.operationStatus,
    operationFailureReason: lifecycle?.operationFailureReason,
    operationFailureAction: lifecycle?.operationFailureAction,
    operationFailureSceneId: lifecycle?.operationFailureSceneId,
    summary: firstMeaningfulLine(asset.body) || asset.title,
    ratio,
    duration,
    phase: capabilityLabel,
    version: asset.versions?.length ? `v${asset.versions.length}` : "v1",
    body,
    markdownBody: asset.body,
    sections,
    timeline: timelineFromVideoProject(videoProject) ?? (mode === "copy" ? [] : timelineFromBody(asset.body, unsupported)),
    actions: suggestionsForCapability(capability, stringValue(rawVideoPlan?.video_type)),
    sourceIds: asset.linked_asset_ids.map((id) => String(id)),
    segments,
    sourceSummary: sourceSummaryForAsset(asset, segments),
    versions: (asset.versions ?? []).map((version) => ({
      id: String(version.id),
      label: `v${version.version}`,
      savedAt: relativeTimeLabel(version.created_at),
      status: version.edit_intent === "restore"
        ? "基于旧版生成"
        : version.instruction
          ? `修订：${version.instruction}`
          : "初始版本"
    })),
    preview: {
      title: normalizeAssetTitle(asset.title),
    subtitle: mp4Artifact ? "已有导出文件，可直接播放" : mp4State === "ready" ? "已有导出文件，可直接播放" : videoProject ? "视频已完成，可查看关键轨道并继续调整分镜" : completedGeneratedImage ? "图片已生成，可作为视频封面或继续调整" : generatingImage ? "图片正在后台生成，完成后自动展示" : orchestrationFailed ? `生成失败：${lifecycle?.failureReason || asset.error_message || "请查看原因后重试或修改脚本"}` : orchestrationPending ? "视频正在后台生成，完成后自动展示" : invalidVideoProject ? "视频内容不完整，无法正常播放或编辑。" : unsupported ? "准备产物，未渲染图片或视频" : templateMode ? "按关键词生成的可编辑模板，不代表真实业务事实" : directorDraft ? "编导脚本已完成，确认后可继续生成视频" : (noAssetHit ? "通用能力生成，未命中素材" : "后端 LLM 生成草稿"),
      eyebrow: capabilityLabel
    }
  };
}

function agentTaskSummaryFromValue(value: unknown): AgentTaskSummary | undefined {
  if (!isRecord(value)) return undefined;
  const goal = stringValue(value.goal);
  const status = stringValue(value.status);
  if (!goal || !status) return undefined;
  return {
    goal,
    status,
    assetId: positiveIntegerValue(value.asset_id),
    versionId: positiveIntegerValue(value.version_id),
    sceneId: stringValue(value.scene_id) || undefined,
  };
}

function agentTasksFromValue(value: unknown): AgentTaskCollection | undefined {
  if (!isRecord(value)) return undefined;
  const active = agentTaskSummaryFromValue(value.active);
  const paused = Array.isArray(value.paused)
    ? value.paused.flatMap((task): AgentTaskSummary[] => {
        const summary = agentTaskSummaryFromValue(task);
        return summary ? [summary] : [];
      })
    : [];
  return active || paused.length ? { active, paused } : undefined;
}

// Convert a persisted backend conversation row into the frontend Conversation
// shape. A fallbackProduct (newly created) may be passed to keep selection stable.
export function conversationFromPersisted(
  row: AssetConversationResponse,
  newConversationProduct: AssetProduct,
  fallbackProduct?: AssetProduct
): AssetConversation {
  const publicTasks = agentTasksFromValue(row.agent_tasks);
  const publicActiveAction = agentActionFromValue(row.active_agent_action);
  const products = row.products.map(contentAssetToProduct);
  const readyVideoProject = [...row.products].reverse().find((asset) => isEditorReadyVideoProject(asset));
  const hasReadyVideoProject = Boolean(readyVideoProject);
  let defaultProductIndex = row.products.length - 1;
  while (defaultProductIndex >= 0 && isMalformedDirectorDraft(row.products[defaultProductIndex])) {
    defaultProductIndex -= 1;
  }
  const product = fallbackProduct
    ? products.find((item) => item.id === fallbackProduct.id) ?? fallbackProduct
    : readyVideoProject
      ? products.find((item) => item.backendAssetId === readyVideoProject.id) ?? newConversationProduct
      : products[defaultProductIndex] ?? newConversationProduct;
  const messages: AssetConversationMessage[] = row.messages
    .filter((message) => {
      const plan = message.metadata.plan;
      return !isRecord(plan) || stringValue(plan.status) !== "superseded";
    })
    .map((message) => {
    const persistedAgentAction = message.role === "assistant"
      ? agentActionFromValue(message.metadata.agent_action)
      : undefined;
    const agentAction = persistedAgentAction;
    return {
      id: message.id,
      createdAt: message.created_at,
      role: message.role,
      text: message.text,
      presentation: confirmationMessagePresentation(message.role, message.metadata),
      assetId: message.asset_id
        ?? positiveIntegerValue(message.metadata.product_id)
        ?? agentAction?.assetId,
      metadata: message.metadata,
      suggestions: message.role === "assistant" ? stringListValue(message.metadata.suggestions) : undefined,
      suggestionActions: message.role === "assistant" ? suggestionActionsValue(message.metadata.suggestion_actions) : undefined,
      plan: message.role === "assistant" ? planFromMetadata(message.metadata.plan) : undefined,
      runSteps: message.role === "assistant" ? agentRunStepsValue(message.metadata.run_steps) : undefined,
      agentAction,
    };
  });
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
  const lastAsset = row.products[defaultProductIndex];
  const projectResources = {
    sources: (row.project_resources?.sources ?? []).map((asset) => ({ id: String(asset.id), title: asset.title })),
    copies: (row.project_resources?.copies ?? []).map((asset) => ({ id: String(asset.id), title: asset.title })),
    covers: (row.project_resources?.covers ?? []).map((asset) => ({ id: String(asset.id), title: asset.title })),
    videos: (row.project_resources?.videos ?? []).map((asset) => ({ id: String(asset.id), title: asset.title })),
  };
  const projectResourceSummary = row.project_resource_summary
    ? {
        sources: row.project_resource_summary.sources,
        historicalSources: row.project_resource_summary.historical_sources,
        copies: row.project_resource_summary.copies,
        covers: row.project_resource_summary.covers,
        videos: row.project_resource_summary.videos,
      }
    : undefined;
  return {
    id: row.id,
    title: row.title || product.title,
    type: "llm-generation",
    updatedAt: relativeTimeLabel(row.updated_at),
    projectState: row.project_state?.code,
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
    suggestions: product.actions ?? [],
    messages,
    agentTasks: hasReadyVideoProject ? undefined : publicTasks,
    activeAgentAction: hasReadyVideoProject ? undefined : publicActiveAction,
    product,
    products: fallbackProduct && !products.some((item) => item.id === fallbackProduct.id) ? [...products, fallbackProduct] : products,
    sourceIds: Array.from(new Set(row.products.flatMap((asset) => asset.linked_asset_ids.map((id) => String(id))))),
    projectResources,
    projectResourceSummary,
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
