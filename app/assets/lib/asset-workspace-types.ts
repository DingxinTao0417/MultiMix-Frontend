import type { VideoQualityReport } from "./video-quality";

export type AssetWorkspaceView = "conversation" | "assets" | "copy" | "image" | "video";

export type AssetProductMode = "copy" | "image" | "video" | "audio" | "mg-overlay";

export type AssetProductSection = {
  label: string;
  title: string;
  detail: string;
  status: string;
};

export type AssetProductTimelineItem = {
  time: string;
  title: string;
  status: string;
  line?: string;
};

export type AssetProductVersion = {
  id: string;
  label: string;
  savedAt: string;
  status: string;
};

export type AssetProductPreviewFrame = {
  title: string;
  subtitle: string;
  tone?: "neutral" | "blue" | "green" | "dark";
};

export type AssetProductPreview = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  posterText?: string;
  prompt?: string;
  frames?: AssetProductPreviewFrame[];
};

// Per-source reference shown by the source-ref block. Only fields that are
// actually known should be set; the UI hides anything missing (no fake data).
export type AssetProductSourceRef = {
  id: string;
  title: string;
  statusLabel?: string;
  referenceCount?: number;
  thumbnailUrl?: string;
  mediaAvailability?: "available" | "missing";
  isFallback?: boolean;
};

export type AssetProductSourceSummary = {
  headline: string;
  note?: string;
  refs: AssetProductSourceRef[];
};

// Storyboard segment summary consumed by the segment cards. Mirrors the
// backend video_project.segments / video_plan.scenes semantic layer
// (asset_reference + mg_decision are authoritative, stock is fallback only).
export type AssetProductSegment = {
  id: string;
  index: number;
  title?: string;
  startSeconds?: number;
  endSeconds?: number;
  line?: string;
  subLine?: string;
  voiceName?: string;
  assetTitle?: string;
  assetThumbnailUrl?: string;
  isFallback: boolean;
  // Mirrors the authoritative draft-stage material_resolution.fill_status.
  // A public candidate is not yet the material ultimately used by the project.
  materialFillStatus?: "saved_hit" | "public_candidate" | "unfilled";
  visualStatusLabel?: "已生成画面" | "产品界面";
  businessHint?: "建议补充真实案例素材";
  primaryVisualSourceType?: "saved_asset" | "public_asset" | "product_asset" | "generated_scene";
  primaryVisualPersisted?: boolean;
  primaryVisualMediaType?: "image" | "video";
  mgLabel?: string;
  mgStatus?: string;
  primaryVisualTreatment?: "material_primary" | "material_enhanced" | "graphics_primary";
  visualTreatmentLabel?: "素材" | "素材加图形 / 素材处理" | "图形主画面";
  selectionReason?: string;
  graphicComponentLabel?: string;
  backgroundTreatmentLabel?: "已验证素材虚化背景";
  publicReplacementNote?: string;
  isPresenter?: boolean;
  presenterEvents?: AssetPresenterVisualEvent[];
  presenterMaterialGap?: string;
};

export type AssetPresenterVisualEvent = {
  id: string;
  type: "text_emphasis" | "media_overlay" | "graphic_overlay" | "media_takeover" | "presenter_reframe";
  label: "文字强调" | "画中画" | "图形说明" | "全屏素材" | "人物让位";
  spokenText?: string;
  purpose?: string;
  statusLabel: "待生成" | "生成中" | "已完成" | "生成失败" | "待更新";
  requiredForPublish: boolean;
};

// A single material candidate shown in the picker. Every selectable row carries
// a server-issued `candidateId`; `assetId` is source metadata only.
export type SegmentMaterialSourceType = "saved_asset" | "public_asset" | "title_card";

export type SegmentMaterialOption = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  reason?: string;
  // Current/non-selectable rows may omit the candidate id.
  candidateId?: string;
  assetId?: number;
  sourceType?: SegmentMaterialSourceType;
  mediaType?: "image" | "video";
  provider?: string;
  author?: string;
  license?: string;
  attributionUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  requiresTrim?: boolean;
  verificationStatus?: string;
  relevanceStatus?: string;
  relevanceReason?: string;
  alreadyPersisted?: boolean;
  // false only for the non-selectable "current material" chip.
  selectable?: boolean;
};

export type SegmentMaterialProviderStatus = {
  provider: string;
  status: string;
};

export type SegmentMaterialOptions = {
  recommended: SegmentMaterialOption[];
  library: SegmentMaterialOption[];
  current?: SegmentMaterialOption[];
  public?: SegmentMaterialOption[];
  providerStatuses?: SegmentMaterialProviderStatus[];
  publicNextCursor?: string | null;
};

export type AssetProduct = {
  id: string;
  mode: AssetProductMode;
  title: string;
  status: string;
  // The only user-facing lifecycle states for 编导脚本 and 视频. Internal job
  // stages stay in execution details and must not be rendered as product state.
  productStatus?: "generating" | "completed" | "failed";
  failureReason?: string;
  failureAction?: "retry" | "modify_script" | "replace_scene_asset";
  failureSceneId?: string;
  operationStatus?: "generating" | "completed" | "failed";
  operationFailureReason?: string;
  operationFailureAction?: "retry" | "modify_script" | "replace_scene_asset";
  operationFailureSceneId?: string;
  summary: string;
  ratio: string;
  duration: string;
  phase: string;
  version?: string;
  body?: string[];
  // Raw markdown source (backend assets only) for rich rendering; `body` is the
  // paragraph-split plain-text fallback used by mock data.
  markdownBody?: string;
  sections: AssetProductSection[];
  timeline: AssetProductTimelineItem[];
  actions: string[];
  sourceIds?: string[];
  sourceSummary?: AssetProductSourceSummary;
  segments?: AssetProductSegment[];
  versions?: AssetProductVersion[];
  preview?: AssetProductPreview;
  // Set when this product is backed by a real backend ContentAsset.
  backendAssetId?: number;
  // Backend identity used by guarded Markdown edits.
  contentType?: string;
  contentHash?: string | null;
  // True only when the backend project satisfies the shared editor-readiness
  // contract. UI surfaces must not infer readiness from raw metadata presence.
  videoProjectReady?: boolean;
  // Server-owned user-visible completion contract. Only a completed product
  // may open the editor or export; project readiness is an internal checkpoint.
  videoProductCompleted?: boolean;
  videoQualityReport?: VideoQualityReport;
  metadata?: Record<string, unknown>;
};

export type AssetVideoSceneReplacement = {
  failedProjectAssetId: number;
  sceneId: string;
};

// Structured confirmation plan attached to an assistant message. Rendered as
// the ConfirmCard two-state card (spec §5.2). Absent → fall back to plain
// message + suggestion chips (spec §12 降级规则). Only fields actually present
// are rendered; the UI never fabricates rows.
export type AssetPlanRef = {
  id?: string;
  title: string;
  thumbnailUrl?: string;
};

export type AssetPlanField = {
  key: string;
  label: string;
  value: string;
  refs?: AssetPlanRef[];
};

export type AssetVideoParameterConfirmation = {
  pendingIntentId: string;
  version: number;
  ratio: string;
  targetSeconds: number;
};

export type AssetLongFormAction =
  | { kind: "analyze"; sourceAssetId: number }
  | { kind: "revise"; analysisAssetId: number }
  | {
    kind: "select";
    analysisAssetId: number;
    candidateId: string;
    cleanupMode?: "conservative" | "preserve_all";
  }
  | { kind: "preserve"; analysisAssetId: number };

export type AssetPlanConfirmationValues = {
  ratio?: string;
  targetSeconds?: number;
  directorCandidateId?: string;
  cleanupCandidateIds?: string[];
  protectedOverrideCandidateIds?: string[];
  confirmProtectedOverride?: boolean;
  audioStreamIndex?: number;
  audioFingerprint?: string;
  transcriptHash?: string;
  sourceSubtitleMode?: "translated_zh" | "source" | "bilingual";
};

export type AssetPlanSubtitleOption = {
  value: "translated_zh" | "source" | "bilingual";
  label: string;
};

export type AssetPresenterDirectionConfirmation = {
  directorCandidateId: string;
};

export type AssetPresenterCleanupConfirmation = {
  cleanupPlanId: string;
  cleanupPlanHash: string;
  selectedCandidateIds: string[];
  protectedOverrideCandidateIds: string[];
  confirmProtectedOverride: boolean;
  audioStreamIndex?: number;
};

export type AssetPresenterAudioSelectionConfirmation = {
  confirmationId: string;
  audioStreamIndex: number;
  audioFingerprint: string;
  transcriptHash: string;
};

export type AssetMessagePlan = {
  kind?: "video_parameter_confirmation" | "video_project_confirmation" | "presenter_audio_selection_confirmation" | "presenter_cleanup_confirmation" | "presenter_project_confirmation" | "agent_action_confirmation";
  title: string;
  // "pending" shows the full field list + confirm/adjust buttons; "confirmed"
  // shows the compact summary rows with a green check badge.
  status: "pending" | "confirmed";
  subtitle?: string;
  fields: AssetPlanField[];
  // Compact summary rows shown once confirmed; falls back to fields when absent.
  summaryFields?: AssetPlanField[];
  confirmLabel?: string;
  adjustLabel?: string;
  // Instruction submitted when the confirm button is pressed.
  confirmUtterance?: string;
  // Video-size selector (spec §5.2): when present the confirm card renders a
  // ratio toggle. `ratioDefault` is the initially-selected option; the chosen
  // ratio is woven into the confirm instruction so the backend can honor it.
  ratioOptions?: AssetPlanRatioOption[];
  ratioDefault?: string;
  durationSeconds?: number;
  durationMin?: number;
  durationMax?: number;
  pendingIntentId?: string;
  pendingIntentVersion?: number;
  confirmationId?: string;
  directionOptions?: AssetPresenterDirectionOption[];
  directionDefault?: string;
  cleanupPlanId?: string;
  cleanupPlanHash?: string;
  cleanupItems?: AssetPresenterCleanupItem[];
  requiresClarification?: boolean;
  audioTrackOptions?: AssetPresenterAudioTrackOption[];
  audioTrackDefault?: number;
  subtitleOptions?: AssetPlanSubtitleOption[];
  subtitleDefault?: "translated_zh" | "source" | "bilingual";
};

export type AssetPresenterCleanupItem = {
  id: string;
  state: "auto" | "suggested" | "protected";
  category: string;
  spokenText: string;
  action: string;
  reason: string;
  decisionLabel?: string;
  decisionReason?: string;
  semanticReview?: {
    verdict: "approve" | "downgrade" | "protect";
    reason: string;
  };
  secondaryRecognition?: {
    status: "confirmed" | "disagreed" | "invalid" | "unavailable";
    label: string;
    model?: string;
  };
  estimatedSavingSeconds: number;
  risk: string;
  audioRisk: string;
  visualJumpRisk: string;
  protectionReasons: string[];
  selected: boolean;
  locked: boolean;
};

export type AssetPresenterAudioTrackOption = {
  streamIndex: number;
  label: string;
  previewUrl: string;
  qualityScore: number;
  recommended: boolean;
  channels: number;
  codec: string;
  audioFingerprint?: string;
  transcriptHash?: string;
};

export type AssetPlanRatioOption = {
  // Canonical ratio the backend parses ("9:16" | "16:9" | "1:1").
  value: string;
  // Merchant-facing chip label, e.g. "横屏 16:9".
  label: string;
};

export type AssetPresenterDirectionOption = {
  id: string;
  label: string;
  concept: string;
  reason: string;
  recommended: boolean;
  sampleUrl: string;
  durationSeconds: number;
};

export type AssetMessagePresentation = "standard" | "hidden_confirmation" | "execution_anchor";

// A single agent execution step (demo workspace「MultiMix 已完成执行」clist).
// Mapped from real backend task events; three visual states + optional elapsed.
export type AgentRunStep = {
  key: string;
  label: string;
  status: "done" | "run" | "wait" | "fail";
  elapsedSeconds?: number;
  elapsedLabel?: string;
  retryJobId?: string;
};

export type AgentActionStatus =
  | "planned"
  | "waiting_confirmation"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "canceled";

export type AgentActionRunResponse = {
  id: string;
  status: AgentActionStatus;
  requiresConfirmation: boolean;
  confirmationId: string | null;
  assetId: number | null;
  versionId: number | null;
  message: string;
  retryable: boolean;
};

export type AgentTaskSummary = {
  goal: string;
  status: string;
  assetId?: number;
  versionId?: number;
  sceneId?: string;
};

export type AgentTaskCollection = {
  active?: AgentTaskSummary;
  paused: AgentTaskSummary[];
};

export type AssetConversationMessage = {
  role: "user" | "assistant";
  text: string;
  presentation?: AssetMessagePresentation;
  suggestions?: string[];
  suggestionActions?: AssetSuggestionAction[];
  // Structured confirmation card payload (spec §5.2); undefined → suggestion chips.
  plan?: AssetMessagePlan;
  // Agent execution timeline attached to an assistant message (demo
  // workspace-video「MultiMix 已完成执行」). Absent → not rendered (spec §12).
  runSteps?: AgentRunStep[];
  agentAction?: AgentActionRunResponse;
  // Backend-backed message fields (optional for mock data).
  assetId?: number | null;
  metadata?: Record<string, unknown>;
  localState?: "failed" | "stopped" | "unsubmitted";
  pending?: boolean;
};

export type AssetSuggestionAction = {
  id: string;
  label: string;
  utterance: string;
  actionType: "fill_composer" | "submit_message" | "open_panel" | "safe_execute" | string;
  mode?: string;
  // True when clicking spends compute on an AI run (generate/rewrite/convert/render).
  // Drives the primary (colored) chip styling, decoupled from actionType (submit vs fill).
  isAiPrimary?: boolean;
  enabled: boolean;
  disabledReason?: string;
  requiresConfirmation: boolean;
};

export type AssetConversation = {
  id: string;
  detailsLoaded?: boolean;
  // Read-only sample conversations cannot be continued (mock starters).
  readonly?: boolean;
  title: string;
  type: string;
  updatedAt: string;
  assetLabel: string;
  status: string;
  prompt: string;
  response: string;
  canvasTitle: string;
  canvasMeta: string;
  raw: string;
  judgment: string;
  action: string;
  delivery: string;
  suggestions: string[];
  messages?: AssetConversationMessage[];
  agentTasks?: AgentTaskCollection;
  activeAgentAction?: AgentActionRunResponse;
  product: AssetProduct;
  products?: AssetProduct[];
  sourceIds?: string[];
};

export type AssetWorkshop = {
  kicker: string;
  title: string;
  description: string;
  metrics: Array<{ value: string; label: string; detail: string }>;
  rows: Array<{
    assetId?: number;
    title: string;
    meta: string;
    note: string;
    kind: "file" | "copy" | "video" | "image";
    category?: string;
    keywords?: string[];
    body?: string[];
    format?: string;
    contentType?: string;
    statusLabel?: string;
    updatedLabel?: string;
    updatedAtIso?: string;
    referenceCount?: number;
    sourceLabel?: string;
    sourceUrl?: string;
    detailLabel?: string;
    sourceRefs?: string[];
    versions?: string[];
    searchReasons?: string[];
    understandingStatus?: string;
    understandingTags?: string[];
    understandingCaption?: string;
    understandingRoles?: string[];
    previewUrl?: string;
    licenseLabel?: string;
    variant?: "digital-human" | "standard";
  }>;
};

export type AssetWorkspaceData = {
  conversations: AssetConversation[];
  newConversation: AssetConversation;
  workshops: Record<Exclude<AssetWorkspaceView, "conversation">, AssetWorkshop>;
};
