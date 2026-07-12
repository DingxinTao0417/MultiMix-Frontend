import { emptyAssetWorkspaceData } from "./asset-workspace-empty-data";
import type { AssetConversation, AssetProduct, AssetSuggestionAction, AssetWorkspaceData, AssetWorkspaceView, AssetWorkshop } from "./asset-workspace-types";
import {
  API_BASE,
  api,
  apiBlob,
  apiForm,
  isApiConfigured,
  type AssetIngestJobActionRead,
  type AssetIngestJobRead,
  type AssetConversationMessageResponse,
  type AssetConversationResponse,
  type AssetConversationSummaryResponse,
  type ContentAsset,
  type ContentAssetSearchResult,
  type ContentAssetRevisionResponse,
  type PublicMaterialCandidate,
  type PublicSourceRead
} from "../../../lib/api";
import { conversationFromPersisted, contentAssetToProduct, isEditorReadyVideoProject, mergePersistedConversations, relativeTimeLabel } from "../../../lib/asset-mappers";
import { isRecord } from "./asset-workspace-shared";

export type LibraryRow = {
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
  previewUrl?: string;
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
  licenseLabel?: string;
  variant?: "digital-human" | "standard";
};

// Trimming variant on purpose: adapter-level strings feed UI labels directly.
function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildConversationMessagePayload({
  conversationId,
  instruction,
  selectedProductId,
  linkedAssetIds,
  clientRequestId,
}: {
  conversationId: string;
  instruction: string;
  selectedProductId?: number;
  linkedAssetIds?: number[];
  clientRequestId?: string;
}) {
  return {
    instruction,
    conversation_id: conversationId === "new" || conversationId.startsWith("draft-") ? undefined : conversationId,
    selected_product_id: selectedProductId,
    linked_asset_ids: linkedAssetIds ?? [],
    client_request_id: clientRequestId,
  };
}

export function findConversationByClientRequestId(
  rows: AssetConversationResponse[],
  clientRequestId: string,
): AssetConversationResponse | null {
  return rows.find((row) => row.messages.some(
    (message) => stringValue(message.metadata?.client_request_id) === clientRequestId,
  )) ?? null;
}

function normalizeSuggestionActions(value: unknown): AssetSuggestionAction[] | undefined {
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
      isAiPrimary: item.is_ai_primary === true,
      enabled: item.enabled !== false,
      disabledReason: stringValue(item.disabled_reason) || undefined,
      requiresConfirmation: item.requires_confirmation !== false
    }];
  });
  return actions.length ? actions : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type AssetUnderstanding = {
  status?: string;
  caption?: string;
  tags: string[];
  roles: Array<{ code: string; label: string; score: number }>;
  sceneTypes: Array<{ code: string; label: string; score: number }>;
};

function understandingStatusLabel(status?: string): string | null {
  if (!status) return null;
  if (status === "pending") return "待理解";
  if (status === "processing") return "理解中";
  if (status === "ready") return "已理解";
  if (status === "failed") return "理解失败";
  return status;
}

function scoredItems(value: unknown): Array<{ code: string; label: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      const code = stringValue(item.code);
      const label = stringValue(item.label) || code;
      if (!code || !label) return [];
      return [{ code, label, score: numberValue(item.score) }];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

function understandingForAsset(asset: ContentAsset): AssetUnderstanding | null {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const understanding = metadata.understanding && typeof metadata.understanding === "object"
    ? metadata.understanding as Record<string, unknown>
    : null;
  if (understanding) {
    return {
      status: stringValue(understanding.status) || undefined,
      caption: stringValue(understanding.caption) || undefined,
      tags: Array.isArray(understanding.tags) ? understanding.tags.map((item) => String(item).trim()).filter(Boolean) : [],
      roles: scoredItems(understanding.storyboard_roles),
      sceneTypes: scoredItems(understanding.scene_types)
    };
  }
  const visual = metadata.visual && typeof metadata.visual === "object" ? metadata.visual as Record<string, unknown> : {};
  const tags = Array.isArray(metadata.visual_tags)
    ? metadata.visual_tags.map((item) => String(item).trim()).filter(Boolean)
    : Array.isArray(visual.tags)
      ? visual.tags.map((item) => String(item).trim()).filter(Boolean)
      : [];
  const caption = stringValue(visual.caption) || stringValue(metadata.caption) || stringValue(metadata.caption_text) || undefined;
  if (!tags.length && !caption) return null;
  return { status: undefined, caption, tags, roles: [], sceneTypes: [] };
}

export type AssetWorkspaceAdapter = {
  getSnapshot(): AssetWorkspaceData;
  listConversations(): AssetConversation[];
  getConversation(conversationId: string): AssetConversation | undefined;
  getNewConversation(): AssetConversation;
  listConversationProducts(conversation: AssetConversation): AssetProduct[];
  getConversationProduct(conversation: AssetConversation, productId?: string): AssetProduct | null;
  getWorkshop(view: Exclude<AssetWorkspaceView, "conversation">): AssetWorkshop;
  getProductText(product: AssetProduct): string;
  saveProduct(product: AssetProduct, token?: string | null): Promise<{ version: string; savedAt: string }>;
  // Backend-backed operations. Without an API, callers render an explicit
  // unconfigured state; writes must not pretend to succeed locally.
  isBackendEnabled(): boolean;
  loadConversationSummaries(token: string): Promise<AssetConversationSummaryResponse[]>;
  mergeConversationSummaries(summaries: AssetConversationSummaryResponse[], current: AssetConversation[]): AssetConversation[];
  loadConversationDetail(token: string, conversationId: string): Promise<AssetConversation>;
  loadConversations(token: string, current: AssetConversation[]): Promise<AssetConversation[]>;
  createConversation(token: string): Promise<AssetConversation>;
  deleteConversation(token: string, conversationId: string): Promise<void>;
  renameConversation(token: string, conversationId: string, title: string): Promise<void>;
  createMaterialPackage(token: string, payload: { title: string; assetIds: number[]; metadata?: Record<string, unknown> }): Promise<ContentAsset>;
  sendMessage(args: {
    token: string;
    conversationId: string;
    instruction: string;
    selectedProductId?: number;
    linkedAssetIds?: number[];
    clientRequestId?: string;
    signal?: AbortSignal;
  }): Promise<{ conversationId: string; conversation: AssetConversation; product: AssetProduct | null }>;
  reconcileMessage(args: {
    token: string;
    clientRequestId: string;
  }): Promise<{ conversationId: string; conversation: AssetConversation; product: AssetProduct | null } | null>;
  reviseProduct(args: {
    token: string;
    product: AssetProduct;
    instruction: string;
    conversationId?: string;
    signal?: AbortSignal;
  }): Promise<{ product: AssetProduct; assistantMessage: string; suggestions: string[]; suggestionActions?: AssetSuggestionAction[]; diffSummary: string }>;
  restoreProductVersion(args: {
    token: string;
    product: AssetProduct;
    versionId: string;
  }): Promise<{ product: AssetProduct; assistantMessage: string; diffSummary: string }>;
  generateVideo(token: string, topic: string, opts?: { language?: string; layout?: string; targetSeconds?: number }): Promise<VideoJobResult>;
  getVideoJob(token: string, jobId: string): Promise<VideoJobResult>;
  retryVideoJob(token: string, jobId: string): Promise<VideoJobResult>;
  listLibrary(token: string, view: Exclude<AssetWorkspaceView, "conversation">, query?: string): Promise<LibraryRow[]>;
  uploadAsset(token: string, file: File, view: Exclude<AssetWorkspaceView, "conversation">): Promise<ContentAsset>;
  createTextAsset(token: string, payload: { title: string; bodyMarkdown: string; contentType?: string }): Promise<ContentAsset>;
  createWebCapture(token: string, payload: { url: string; title?: string; body: string; contentType?: string }): Promise<ContentAsset>;
  getLatestIngestJob(token: string, assetId: number): Promise<AssetIngestJobRead>;
  retryAssetIngest(token: string, assetId: number): Promise<AssetIngestJobActionRead>;
  exportAssetMarkdown(token: string, assetId: number): Promise<Blob>;
  downloadAsset(token: string, assetId: number): Promise<Blob>;
  deleteAsset(token: string, assetId: number): Promise<void>;
  reparseAsset(token: string, assetId: number): Promise<ContentAsset>;
  listPublicSources(token: string, mediaType?: "text" | "image" | "video"): Promise<PublicSourceRead[]>;
  searchPublicMaterials(token: string, payload: { query: string; mediaTypes: Array<"text" | "image" | "video">; providers?: string[]; limit?: number }): Promise<PublicMaterialCandidate[]>;
  importPublicMaterial(token: string, candidate: PublicMaterialCandidate): Promise<ContentAsset>;
  listAdminPublicSources(token: string): Promise<PublicSourceRead[]>;
  updateAdminPublicSource(token: string, provider: string, payload: Partial<Pick<PublicSourceRead, "enabled" | "media_types">>): Promise<PublicSourceRead>;
  checkAdminPublicSourceHealth(token: string, provider: string): Promise<PublicSourceRead>;
};

export function conversationFromSummary(
  row: AssetConversationSummaryResponse,
  newConversationProduct: AssetProduct,
): AssetConversation {
  return {
    id: row.id,
    detailsLoaded: false,
    title: row.title,
    type: "llm-generation",
    updatedAt: relativeTimeLabel(row.updated_at),
    assetLabel: "对话历史",
    status: row.status,
    prompt: "",
    response: "",
    canvasTitle: row.title,
    canvasMeta: "",
    raw: "",
    judgment: "",
    action: "",
    delivery: "",
    suggestions: [],
    messages: [],
    product: newConversationProduct,
    products: [],
    sourceIds: [],
  };
}

export async function retryConversationDetailLoad<T>(
  load: () => Promise<T>,
  wait: () => Promise<void> = () => new Promise((resolve) => window.setTimeout(resolve, 600)),
): Promise<T> {
  try {
    return await load();
  } catch {
    await wait();
    return load();
  }
}

export type VideoJobStepResult = {
  key: string;
  label: string;
  status: string;
  elapsedSeconds: number | null;
  retryJobId: string | null;
};

export type VideoJobResult = {
  id: string;
  assetId: number;
  status: string;
  renderStage: string;
  steps: VideoJobStepResult[];
  errorMessage: string | null;
  project: Record<string, unknown> | null;
};

type RawVideoJob = {
  id: string;
  asset_id: number;
  status: string;
  render_stage: string;
  steps?: Array<{
    key?: string;
    label?: string;
    status?: string;
    elapsed_seconds?: number | null;
    retry_job_id?: string | null;
  }> | null;
  error_message: string | null;
  project: Record<string, unknown> | null;
};

// Normalise a backend video-job payload into VideoJobResult. steps[] is a
// newer field; older backends omit it and the timeline falls back to the
// render_stage-derived steps (spec §12 降级规则).
function mapVideoJob(raw: RawVideoJob): VideoJobResult {
  const steps = Array.isArray(raw.steps)
    ? raw.steps.flatMap((step): VideoJobStepResult[] => {
        const key = typeof step.key === "string" ? step.key : "";
        const label = typeof step.label === "string" ? step.label : "";
        if (!key || !label) return [];
        return [{
          key,
          label,
          status: typeof step.status === "string" ? step.status : "wait",
          elapsedSeconds: typeof step.elapsed_seconds === "number" ? step.elapsed_seconds : null,
          retryJobId: typeof step.retry_job_id === "string" ? step.retry_job_id : null
        }];
      })
    : [];
  return {
    id: raw.id,
    assetId: raw.asset_id,
    status: raw.status,
    renderStage: raw.render_stage,
    steps,
    errorMessage: raw.error_message,
    project: raw.project
  };
}

// Map a library view to the backend asset_kind values it should display.
function libraryKindsForView(view: Exclude<AssetWorkspaceView, "conversation">): string[] {
  if (view === "copy") return ["copy"];
  if (view === "image") return ["image"];
  if (view === "video") return ["video", "video_render"];
  return ["asset"]; // 资产库: uploaded/captured knowledge sources
}

function libraryRowKind(asset: ContentAsset): LibraryRow["kind"] {
  if (asset.asset_kind === "image") return "image";
  if (asset.asset_kind === "video" || asset.asset_kind === "video_render") return "video";
  if (asset.asset_kind === "copy") return "copy";
  return "file";
}

function inferKeywords(asset: ContentAsset): string[] {
  const text = `${asset.title} ${asset.body ?? ""}`.toLowerCase();
  const seeds = ["产品种草", "小红书", "抖音", "LinkedIn", "封面", "数字人", "口播", "产品图", "视频脚本", "规则变化", "品牌约束"];
  const matched = seeds.filter((keyword) => text.includes(keyword.toLowerCase()));
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const understanding = understandingForAsset(asset);
  const visual = metadata.visual && typeof metadata.visual === "object" ? metadata.visual as Record<string, unknown> : {};
  const visualTags = understanding?.tags.length
    ? understanding.tags
    : Array.isArray(metadata.visual_tags)
      ? metadata.visual_tags
      : Array.isArray(visual.tags)
        ? visual.tags
        : [];
  const captionKeywords = Array.isArray(metadata.caption_keywords) ? metadata.caption_keywords : [];
  const roleLabels = understanding?.roles.map((item) => item.label) ?? [];
  const roleCodes = understanding?.roles.map((item) => item.code) ?? [];
  const sceneLabels = understanding?.sceneTypes.map((item) => item.label) ?? [];
  const sceneCodes = understanding?.sceneTypes.map((item) => item.code) ?? [];
  const fallback: Record<LibraryRow["kind"], string[]> = {
    copy: ["文案", "可复用", "已归档"],
    image: ["图片", "视觉素材", "可检索"],
    video: ["视频", "口播", "可复用"],
    file: ["资料", "来源", "可检索"]
  };
  return [...visualTags, ...captionKeywords, ...roleLabels, ...roleCodes, ...sceneLabels, ...sceneCodes, ...matched, ...fallback[libraryRowKind(asset)]]
    .map((keyword) => String(keyword).trim())
    .filter((keyword, index, array) => Boolean(keyword) && array.indexOf(keyword) === index)
    .slice(0, 8);
}

function inferAssetSourceCategory(asset: ContentAsset): string {
  const sourceType = String(asset.source_type ?? "").trim().toLowerCase();
  if (sourceType === "upload" || sourceType === "manual_text") return "上传资料";
  if (sourceType === "web_capture" || sourceType === "public_source") return "采集资料";
  if (sourceType === "conversation" || sourceType === "chat_upload") return "对话沉淀";
  const text = `${asset.content_type} ${asset.title} ${asset.source_filename ?? ""} ${asset.original_ref ?? ""} ${asset.markdown_ref ?? ""} ${asset.body ?? ""}`.toLowerCase();
  if (/conversation|dialog|chat|对话|沉淀|偏好|画像|卖点|品牌信息/.test(text)) return "对话沉淀";
  if (/reader|crawl|capture|web|url|http|公众号|网页|采集|链接|markdown/.test(text)) return "采集资料";
  return "上传资料";
}

function contentTypeLabel(asset: ContentAsset): string {
  const sourceType = asset.source_content_type?.toLowerCase() ?? "";
  const filename = asset.source_filename?.toLowerCase() ?? "";
  const text = `${asset.content_type} ${sourceType} ${filename}`.toLowerCase();
  if (/pdf/.test(text)) return "PDF";
  if (/spreadsheet|excel|xlsx|xls|csv/.test(text)) return "表格";
  if (/presentation|powerpoint|ppt/.test(text)) return "PPT";
  if (/word|docx|doc/.test(text)) return "文档";
  if (/image|png|jpe?g|webp|gif/.test(text)) return "图片";
  if (/video|mp4|mov|webm/.test(text)) return "视频";
  if (/audio|mp3|wav|m4a/.test(text)) return "音频";
  if (/url|web|html|markdown|reader/.test(text)) return "网页";
  return "资料";
}

// Store refs (local://, supabase://, s3://) are only readable through the
// backend's unauthenticated media proxy; browsers can't open them directly.
export function mediaProxyUrl(ref: string): string {
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
}

function previewUrlForAsset(asset: ContentAsset): string | undefined {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const videoProject = metadata.video_project && typeof metadata.video_project === "object" && !Array.isArray(metadata.video_project)
    ? metadata.video_project as Record<string, unknown>
    : null;
  const mp4Ref = typeof videoProject?.mp4_ref === "string" ? videoProject.mp4_ref.trim() : "";
  if (mp4Ref) return mediaProxyUrl(mp4Ref);
  const candidates = [
    metadata.preview_url,
    metadata.thumbnail_url,
    metadata.download_url,
    metadata.source_url,
    asset.original_ref
  ];
  return candidates
    .map((item) => typeof item === "string" ? item.trim() : "")
    .find((item) => /^https?:\/\//i.test(item));
}

function statusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "ready") return "已入库";
  if (normalized === "processing") return "解析中";
  if (normalized === "failed") return "解析失败";
  if (normalized === "draft") return "待解析";
  if (normalized === "archived") return "已归档";
  return status;
}

function videoProjectStatusLabel(asset: ContentAsset): string | null {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const rawVideoProject = metadata.video_project && typeof metadata.video_project === "object"
    ? metadata.video_project as Record<string, unknown>
    : null;
  const videoProject = rawVideoProject && isEditorReadyVideoProject(asset, rawVideoProject) ? rawVideoProject : null;
  if (rawVideoProject && !videoProject) return "工程异常";
  const mp4State = typeof videoProject?.mp4_state === "string" ? videoProject.mp4_state : "";
  if (mp4State === "ready") return "MP4已生成";
  if (mp4State === "running") return "成片生成中";
  if (mp4State === "failed") return "成片失败";
  if (videoProject) return "可编辑";
  return null;
}

function artifactCategory(asset: ContentAsset): string {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Record<string, unknown> : {};
  if (typeof metadata.artifact_category === "string" && metadata.artifact_category.trim()) return metadata.artifact_category.trim();
  if (asset.content_type === "content_plan") return "选题方案";
  if (asset.content_type === "short_video_narration" || asset.content_type === "video_script") return "编导稿";
  if (asset.content_type === "social_post") return "文案稿";
  if (asset.content_type === "video_render") return "视频工程";
  return "";
}

function normalizeAssetTitle(title: string): string {
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

function inferLibraryCategory(asset: ContentAsset): string {
  const explicit = artifactCategory(asset);
  if (explicit) return explicit;
  const text = `${asset.content_type} ${asset.title} ${asset.body ?? ""}`.toLowerCase();
  if (asset.asset_kind === "asset") return inferAssetSourceCategory(asset);
  if (asset.asset_kind === "copy") {
    if (asset.content_type === "content_plan" || /选题|方案|内容方案|选题方案/.test(text)) return "选题方案";
    if (asset.content_type === "video_script" || /编导|脚本|分镜|镜头|导演/.test(text)) return "编导稿";
    return "文案稿";
  }
  if (asset.asset_kind === "image") {
    if (asset.content_type === "storyboard_image" || /分镜/.test(text)) return "分镜图";
    if (asset.content_type === "cover_image" || /封面/.test(text)) return "封面图";
    return "素材图";
  }
  if (asset.asset_kind === "video" || asset.asset_kind === "video_render") {
    if (asset.content_type === "video_render") return "视频工程";
    if (asset.content_type === "digital_human_video" || /数字人|avatar|talking head/i.test(text)) return "数字人视频";
    if (asset.content_type === "mg_animation_video" || /mg|动画|motion/.test(text)) return "MG动画视频";
    if (asset.content_type === "real_scene_video" || /实景|拍摄|真人|出镜/.test(text)) return "实景拍摄视频";
    if (asset.content_type === "generated_video" || /生成视频|文生视频|text-to-video/.test(text)) return "生成视频素材";
    return "混剪视频";
  }
  return "资料";
}

export function libraryCategoryForAsset(asset: ContentAsset): string {
  return inferLibraryCategory(asset);
}

function searchReasonLabels(fields: string[]): string[] {
  const labels: Record<string, string> = {
    title: "标题命中",
    body: "正文命中",
    source_filename: "来源命中",
    metadata: "元数据命中",
    chunks: "正文命中",
    semantic_chunks: "语义相关"
  };
  return fields.map((field) => labels[field] ?? field).filter((label, index, array) => array.indexOf(label) === index);
}

function contentAssetToLibraryRow(asset: ContentAsset, searchReasons: string[] = []): LibraryRow {
  const category = inferLibraryCategory(asset);
  const understanding = understandingForAsset(asset);
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Record<string, unknown> : {};
  const noAssetHit = Boolean(metadata.no_asset_hit);
  const status = category === "编导稿"
    ? (videoProjectStatusLabel(asset) ?? (noAssetHit ? "未命中素材" : "有来源"))
    : (videoProjectStatusLabel(asset)
      ?? ((asset.asset_kind === "image" || asset.asset_kind === "video" || asset.asset_kind === "video_render")
        ? understandingStatusLabel(understanding?.status) ?? statusLabel(asset.status)
        : statusLabel(asset.status)));
  const sourceUrl = typeof asset.metadata?.source_url === "string" ? asset.metadata.source_url : undefined;
  const visual = asset.metadata?.visual && typeof asset.metadata.visual === "object" ? asset.metadata.visual as Record<string, unknown> : {};
  const visualTags = understanding?.tags.length
    ? understanding.tags
    : Array.isArray(asset.metadata?.visual_tags)
      ? asset.metadata.visual_tags.map((item) => String(item))
      : Array.isArray(visual.tags)
        ? visual.tags.map((item) => String(item))
        : [];
  const visualCaption = understanding?.caption || (typeof visual.caption === "string" ? visual.caption : undefined);
  const licenseLabel = typeof asset.metadata?.license_label === "string" ? asset.metadata.license_label : undefined;
  return {
    assetId: asset.id,
    title: normalizeAssetTitle(asset.title),
    meta: asset.asset_kind === "asset" ? `${contentTypeLabel(asset)} · ${status}` : `${category} · ${status}`,
    note: visualCaption || (asset.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "（无摘要）",
    kind: libraryRowKind(asset),
    category,
    keywords: inferKeywords(asset),
    body: (asset.body ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).slice(0, 4),
    contentType: contentTypeLabel(asset),
    statusLabel: status,
    updatedLabel: asset.updated_at ? relativeTimeLabel(asset.updated_at) : undefined,
    updatedAtIso: asset.updated_at || undefined,
    referenceCount: typeof metadata.reference_count === "number" && Number.isFinite(metadata.reference_count) && metadata.reference_count >= 0
      ? metadata.reference_count
      : undefined,
    sourceLabel: asset.source_filename ?? sourceUrl ?? asset.original_ref ?? asset.markdown_ref ?? "对话或系统沉淀",
    sourceUrl,
    previewUrl: previewUrlForAsset(asset),
    sourceRefs: (asset.source_mapping ?? [])
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const record = item as Record<string, unknown>;
        return [record.title, record.source_type, record.asset_id ?? record.state ?? record.url].filter(Boolean).join(" · ");
      })
      .filter(Boolean)
      .slice(0, 5),
    versions: (asset.versions ?? []).map((version) => `v${version.version}${version.instruction ? ` · ${version.instruction}` : ""}`).slice(-5),
    searchReasons,
    captionStatus: typeof asset.metadata?.caption_status === "string" ? asset.metadata.caption_status : undefined,
    visualTags,
    visualCaption,
    understandingStatus: understanding?.status,
    understandingTags: understanding?.tags ?? [],
    understandingCaption: understanding?.caption,
    understandingRoles: understanding?.roles.map((item) => item.label) ?? [],
    licenseLabel,
    variant: /数字人|avatar|talking head/i.test(`${asset.title} ${asset.body ?? ""}`) ? "digital-human" : "standard"
  };
}

function libraryKindParam(view: Exclude<AssetWorkspaceView, "conversation">): string {
  return view === "assets" ? "assets" : view;
}

function mergeSearchResults(keywordRows: ContentAssetSearchResult[], semanticRows: ContentAssetSearchResult[]): LibraryRow[] {
  const merged = new Map<number, { asset: ContentAsset; reasons: string[]; score: number; order: number }>();
  let order = 0;
  for (const row of keywordRows) {
    merged.set(row.asset.id, {
      asset: row.asset,
      reasons: searchReasonLabels(row.matched_fields ?? []),
      score: row.score + 10,
      order
    });
    order += 1;
  }
  for (const row of semanticRows) {
    const existing = merged.get(row.asset.id);
    const reasons = searchReasonLabels(row.matched_fields?.length ? row.matched_fields : ["semantic_chunks"]);
    if (existing) {
      existing.reasons = [...existing.reasons, ...reasons].filter((label, index, array) => array.indexOf(label) === index);
      existing.score = Math.max(existing.score, row.score);
      continue;
    }
    merged.set(row.asset.id, {
      asset: row.asset,
      reasons,
      score: row.score,
      order
    });
    order += 1;
  }
  return [...merged.values()]
    .sort((left, right) => (right.score - left.score) || (left.order - right.order))
    .map((item) => contentAssetToLibraryRow(item.asset, item.reasons));
}

function createAssetWorkspaceAdapter(data: AssetWorkspaceData): AssetWorkspaceAdapter {
  return {
    getSnapshot() {
      return data;
    },
    listConversations() {
      return data.conversations;
    },
    getConversation(conversationId) {
      return data.conversations.find((conversation) => conversation.id === conversationId);
    },
    getNewConversation() {
      return data.newConversation;
    },
    listConversationProducts(conversation) {
      return conversation.products && conversation.products.length > 0 ? conversation.products : [conversation.product];
    },
    getConversationProduct(conversation, productId) {
      const products = this.listConversationProducts(conversation);
      return products.find((product) => product.id === productId) ?? products[products.length - 1] ?? conversation.product;
    },
    getWorkshop(view) {
      return data.workshops[view];
    },
    getProductText(product) {
      return (product.body && product.body.length > 0 ? product.body : [product.summary]).join("\n\n");
    },
    async saveProduct(product, token) {
      if (isApiConfigured && token && product.backendAssetId) {
        await api<unknown>(`/assets/${product.backendAssetId}`, token, {
          method: "PATCH",
          body: JSON.stringify({
            title: product.title,
            body: product.body?.join("\n\n") ?? product.summary,
          })
        });
        const nextVersion = product.version ? `v${parseInt(product.version.replace("v", "")) + 1}` : "v2";
        return { version: nextVersion, savedAt: new Date().toISOString() };
      }
      throw new Error("未连接后端，无法保存产物。");
    },
    isBackendEnabled() {
      return isApiConfigured;
    },
    async loadConversationSummaries(token) {
      return api<AssetConversationSummaryResponse[]>("/assets/conversations/summaries", token);
    },
    mergeConversationSummaries(summaries, current) {
      const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
      return summaries.map((summary) => {
        const existing = currentById.get(summary.id);
        if (existing && existing.detailsLoaded !== false) {
          return {
            ...existing,
            title: summary.title,
            status: summary.status,
            updatedAt: relativeTimeLabel(summary.updated_at),
          };
        }
        return conversationFromSummary(summary, data.newConversation.product);
      });
    },
    async loadConversationDetail(token, conversationId) {
      const row = await retryConversationDetailLoad(
        () => api<AssetConversationResponse>(
          `/assets/conversations/${encodeURIComponent(conversationId)}`,
          token,
        ),
      );
      return {
        ...conversationFromPersisted(row, data.newConversation.product),
        detailsLoaded: true,
      };
    },
    async loadConversations(token, current) {
      const rows = await api<AssetConversationResponse[]>("/assets/conversations", token);
      return mergePersistedConversations(rows, current, data.newConversation.product).map((conversation) => ({
        ...conversation,
        detailsLoaded: true,
      }));
    },
    async createConversation(token) {
      const row = await api<AssetConversationResponse>("/assets/conversations", token, { method: "POST" });
      return conversationFromPersisted(row, data.newConversation.product);
    },
    async deleteConversation(token, conversationId) {
      await api<void>(`/assets/conversations/${encodeURIComponent(conversationId)}`, token, {
        method: "DELETE"
      });
    },
    async renameConversation(token, conversationId, title) {
      await api<AssetConversationResponse>(`/assets/conversations/${encodeURIComponent(conversationId)}`, token, {
        method: "PATCH",
        body: JSON.stringify({ title })
      });
    },
    async createMaterialPackage(token, payload) {
      return api<ContentAsset>("/assets/material-packages", token, {
        method: "POST",
        body: JSON.stringify({
          title: payload.title,
          asset_ids: payload.assetIds,
          metadata: payload.metadata ?? {}
        })
      });
    },
    async sendMessage({ token, conversationId, instruction, selectedProductId, linkedAssetIds, clientRequestId, signal }) {
      const response = await api<AssetConversationMessageResponse>("/assets/conversations/messages", token, {
        method: "POST",
        signal,
        body: JSON.stringify(buildConversationMessagePayload({
          conversationId,
          instruction,
          selectedProductId,
          linkedAssetIds,
          clientRequestId,
        }))
      });
      const generatedProduct = response.product ? contentAssetToProduct(response.product) : undefined;
      const conversation = conversationFromPersisted(response.conversation, data.newConversation.product, generatedProduct);
      const product = generatedProduct ?? null;
      return { conversationId: response.conversation_id, conversation, product };
    },
    async reconcileMessage({ token, clientRequestId }) {
      const rows = await api<AssetConversationResponse[]>("/assets/conversations", token);
      const row = findConversationByClientRequestId(rows, clientRequestId);
      if (!row) return null;
      const matchedMessage = row.messages.find(
        (message) => stringValue(message.metadata?.client_request_id) === clientRequestId && message.asset_id,
      );
      const matchedAsset = matchedMessage?.asset_id
        ? row.products.find((asset) => asset.id === matchedMessage.asset_id)
        : row.products[row.products.length - 1];
      const generatedProduct = matchedAsset ? contentAssetToProduct(matchedAsset) : undefined;
      const conversation = conversationFromPersisted(row, data.newConversation.product, generatedProduct);
      return {
        conversationId: row.id,
        conversation,
        product: generatedProduct ?? null,
      };
    },
    async reviseProduct({ token, product, instruction, conversationId, signal }) {
      if (!isApiConfigured || !token || !product.backendAssetId) {
        throw new Error("未连接后端，无法修订产物。");
      }
      const response = await api<ContentAssetRevisionResponse>(`/assets/${product.backendAssetId}/revisions`, token, {
          method: "POST",
          signal,
          body: JSON.stringify({
            instruction,
            conversation_id: conversationId === "new" ? undefined : conversationId
          })
        });
      return {
          product: contentAssetToProduct(response.asset),
          assistantMessage: response.assistant_message,
          suggestions: response.suggestions,
          suggestionActions: normalizeSuggestionActions(response.suggestion_actions),
          diffSummary: response.diff_summary
      };
    },
    async restoreProductVersion({ token, product, versionId }) {
      if (!isApiConfigured || !token || !product.backendAssetId) {
        throw new Error("未连接后端，无法恢复版本。");
      }
      const response = await api<ContentAssetRevisionResponse>(`/assets/${product.backendAssetId}/versions/${encodeURIComponent(versionId)}/restore`, token, {
          method: "POST"
        });
      return {
          product: contentAssetToProduct(response.asset),
          assistantMessage: response.assistant_message,
          diffSummary: response.diff_summary
      };
    },
    async generateVideo(token, topic, opts) {
      const body = {
        topic,
        language: opts?.language ?? "zh-CN",
        layout: opts?.layout ?? "portrait",
        target_seconds: opts?.targetSeconds ?? 60,
      };
      const raw = await api<RawVideoJob>("/video/generate", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return mapVideoJob(raw);
    },
    async getVideoJob(token, jobId) {
      const raw = await api<RawVideoJob>(`/video/jobs/${encodeURIComponent(jobId)}`, token);
      return mapVideoJob(raw);
    },
    async retryVideoJob(token, jobId) {
      const raw = await api<RawVideoJob>(`/video/jobs/${encodeURIComponent(jobId)}/retry`, token, {
        method: "POST",
      });
      return mapVideoJob(raw);
    },
    async listLibrary(token, view, query) {
      const kinds = libraryKindsForView(view);
      const trimmedQuery = query?.trim() ?? "";
      if (trimmedQuery) {
        const params = new URLSearchParams({ q: trimmedQuery, library_kind: libraryKindParam(view), limit: "50" });
        const [keywordResult, semanticResult] = await Promise.allSettled([
          api<ContentAssetSearchResult[]>(`/assets/search?${params.toString()}`, token),
          api<ContentAssetSearchResult[]>(`/assets/semantic-search?${params.toString()}`, token)
        ]);
        const keywordRows = keywordResult.status === "fulfilled" ? keywordResult.value : [];
        const semanticRows = semanticResult.status === "fulfilled" ? semanticResult.value : [];
        const mergedRows = mergeSearchResults(keywordRows, semanticRows)
          .filter((row) => row.assetId == null || kinds.includes(row.kind === "file" ? "asset" : row.kind));
        if (mergedRows.length || keywordResult.status === "fulfilled" || semanticResult.status === "fulfilled") return mergedRows;
      }
      // Fetch per kind instead of the full /assets list. The full list pulls
      // every asset kind (hundreds of rows + selectinload versions) over the
      // remote Supabase link and can take 45s+ or time out, which made the UI
      // fall back to mock rows (no updatedLabel/status). Scoping to the view's
      // kind(s) keeps each request small and fast.
      const kindResults = await Promise.allSettled(
        kinds.map((kind) =>
          api<ContentAsset[]>(`/assets?kind=${encodeURIComponent(kind)}&limit=200`, token)
        )
      );
      // Settle each kind independently: the video library pulls both "video" and
      // "video_render"; if one kind is slow or fails it must not blank out the
      // other. Rows sort by updated_at so mixed kinds interleave correctly.
      return kindResults
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .map((asset) => contentAssetToLibraryRow(asset))
        .sort((a, b) => (b.updatedAtIso ?? "").localeCompare(a.updatedAtIso ?? ""));
    },
    async uploadAsset(token, file, view) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("target_kind", view === "assets" ? "asset" : view);
      return apiForm<ContentAsset>("/assets/upload", token, formData);
    },
    async createTextAsset(token, payload) {
      return api<ContentAsset>("/assets/text", token, {
        method: "POST",
        body: JSON.stringify({
          title: payload.title,
          body_markdown: payload.bodyMarkdown,
          library_kind: "assets",
          content_type: payload.contentType ?? "manual_text"
        })
      });
    },
    async createWebCapture(token, payload) {
      return api<ContentAsset>("/assets/web-captures", token, {
        method: "POST",
        body: JSON.stringify({
          url: payload.url,
          title: payload.title,
          body: payload.body,
          content_type: payload.contentType ?? "text/html"
        })
      });
    },
    async getLatestIngestJob(token, assetId) {
      return api<AssetIngestJobRead>(`/assets/${assetId}/ingest-jobs/latest`, token);
    },
    async retryAssetIngest(token, assetId) {
      const latest = await this.getLatestIngestJob(token, assetId);
      await api<AssetIngestJobActionRead>(`/assets/ingest-jobs/${encodeURIComponent(latest.id)}/retry`, token, { method: "POST" });
      return api<AssetIngestJobActionRead>(`/assets/ingest-jobs/${encodeURIComponent(latest.id)}/process`, token, { method: "POST" });
    },
    async exportAssetMarkdown(token, assetId) {
      return apiBlob(`/assets/${assetId}/export.md`, token);
    },
    async downloadAsset(token, assetId) {
      return apiBlob(`/assets/${assetId}/download`, token);
    },
    async deleteAsset(token, assetId) {
      await api<void>(`/assets/${assetId}`, token, { method: "DELETE" });
    },
    async reparseAsset(token, assetId) {
      return api<ContentAsset>(`/assets/${assetId}/reparse`, token, { method: "POST" });
    },
    async listPublicSources(token, mediaType) {
      const query = mediaType ? `?media_type=${encodeURIComponent(mediaType)}` : "";
      return api<PublicSourceRead[]>(`/assets/public-sources${query}`, token);
    },
    async searchPublicMaterials(token, payload) {
      const response = await api<{ query: string; candidates: PublicMaterialCandidate[] }>("/assets/public-search", token, {
        method: "POST",
        body: JSON.stringify({
          query: payload.query,
          media_types: payload.mediaTypes,
          providers: payload.providers,
          limit: payload.limit ?? 12
        })
      });
      return response.candidates;
    },
    async importPublicMaterial(token, candidate) {
      return api<ContentAsset>("/assets/public-import", token, {
        method: "POST",
        body: JSON.stringify({ candidate })
      });
    },
    async listAdminPublicSources(token) {
      return api<PublicSourceRead[]>("/admin/public-sources", token);
    },
    async updateAdminPublicSource(token, provider, payload) {
      return api<PublicSourceRead>(`/admin/public-sources/${encodeURIComponent(provider)}`, token, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
    },
    async checkAdminPublicSourceHealth(token, provider) {
      return api<PublicSourceRead>(`/admin/public-sources/${encodeURIComponent(provider)}/health`, token, { method: "POST" });
    }
  };
}

export const assetWorkspaceAdapter = createAssetWorkspaceAdapter(emptyAssetWorkspaceData);
