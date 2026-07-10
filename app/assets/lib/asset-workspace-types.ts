export type AssetWorkspaceView = "conversation" | "assets" | "copy" | "image" | "video";

export type AssetProductMode = "copy" | "image" | "video" | "audio" | "digital-human" | "mg_animation_video";

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
  assetTitle?: string;
  assetThumbnailUrl?: string;
  isFallback: boolean;
  mgLabel?: string;
};

export type AssetProduct = {
  id: string;
  mode: AssetProductMode;
  title: string;
  status: string;
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
  metadata?: Record<string, unknown>;
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

export type AssetMessagePlan = {
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
};

export type AssetPlanRatioOption = {
  // Canonical ratio the backend parses ("9:16" | "16:9" | "1:1").
  value: string;
  // Merchant-facing chip label, e.g. "横屏 16:9".
  label: string;
};

// A single agent execution step (demo workspace「MultiMix 已完成执行」clist).
// Mapped from real backend task events; three visual states + optional elapsed.
export type AgentRunStep = {
  key: string;
  label: string;
  status: "done" | "run" | "wait" | "fail";
  elapsedLabel?: string;
};

export type AssetConversationMessage = {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  suggestionActions?: AssetSuggestionAction[];
  // Structured confirmation card payload (spec §5.2); undefined → suggestion chips.
  plan?: AssetMessagePlan;
  // Agent execution timeline attached to an assistant message (demo
  // workspace-video「MultiMix 已完成执行」). Absent → not rendered (spec §12).
  runSteps?: AgentRunStep[];
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
  capability?: string;
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
    captionStatus?: string;
    visualTags?: string[];
    visualCaption?: string;
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
