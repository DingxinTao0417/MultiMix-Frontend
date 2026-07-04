import { mockAssetWorkspaceData } from "./asset-workspace-mock-data";
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
  type ContentAsset,
  type ContentAssetSearchResult,
  type ContentAssetRevisionResponse,
  type PublicMaterialCandidate,
  type PublicSourceRead
} from "../../../lib/api";
import { conversationFromPersisted, contentAssetToProduct, mergePersistedConversations } from "../../../lib/asset-mappers";
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
  licenseLabel?: string;
  variant?: "digital-human" | "standard";
};

// Trimming variant on purpose: adapter-level strings feed UI labels directly.
function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
      enabled: item.enabled !== false,
      disabledReason: stringValue(item.disabled_reason) || undefined,
      requiresConfirmation: item.requires_confirmation !== false
    }];
  });
  return actions.length ? actions : undefined;
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
  // Backend-backed operations. When no API is configured these are no-ops that
  // keep the local mock workspace usable offline.
  isBackendEnabled(): boolean;
  loadConversations(token: string, current: AssetConversation[]): Promise<AssetConversation[]>;
  createConversation(token: string): Promise<AssetConversation>;
  sendMessage(args: {
    token: string;
    conversationId: string;
    instruction: string;
    selectedProductId?: number;
    linkedAssetIds?: number[];
    signal?: AbortSignal;
  }): Promise<{ conversationId: string; conversation: AssetConversation; product: AssetProduct | null }>;
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
  regenerateImageCaption(token: string, assetId: number): Promise<ContentAsset>;
  listPublicSources(token: string, mediaType?: "text" | "image" | "video"): Promise<PublicSourceRead[]>;
  searchPublicMaterials(token: string, payload: { query: string; mediaTypes: Array<"text" | "image" | "video">; providers?: string[]; limit?: number }): Promise<PublicMaterialCandidate[]>;
  importPublicMaterial(token: string, candidate: PublicMaterialCandidate): Promise<ContentAsset>;
  listAdminPublicSources(token: string): Promise<PublicSourceRead[]>;
  updateAdminPublicSource(token: string, provider: string, payload: Partial<Pick<PublicSourceRead, "enabled" | "media_types">>): Promise<PublicSourceRead>;
  checkAdminPublicSourceHealth(token: string, provider: string): Promise<PublicSourceRead>;
};

export type VideoJobResult = {
  id: string;
  assetId: number;
  status: string;
  renderStage: string;
  errorMessage: string | null;
  project: Record<string, unknown> | null;
};

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
  const visual = metadata.visual && typeof metadata.visual === "object" ? metadata.visual as Record<string, unknown> : {};
  const visualTags = Array.isArray(metadata.visual_tags)
    ? metadata.visual_tags
    : Array.isArray(visual.tags)
      ? visual.tags
      : [];
  const captionKeywords = Array.isArray(metadata.caption_keywords) ? metadata.caption_keywords : [];
  const fallback: Record<LibraryRow["kind"], string[]> = {
    copy: ["文案", "可复用", "已归档"],
    image: ["图片", "视觉素材", "可检索"],
    video: ["视频", "口播", "可复用"],
    file: ["资料", "来源", "可检索"]
  };
  return [...visualTags, ...captionKeywords, ...matched, ...fallback[libraryRowKind(asset)]]
    .map((keyword) => String(keyword).trim())
    .filter((keyword, index, array) => Boolean(keyword) && array.indexOf(keyword) === index)
    .slice(0, 8);
}

function inferAssetSourceCategory(asset: ContentAsset): string {
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
  const videoProject = metadata.video_project && typeof metadata.video_project === "object"
    ? metadata.video_project as Record<string, unknown>
    : null;
  const mp4State = typeof videoProject?.mp4_state === "string" ? videoProject.mp4_state : "";
  if (mp4State === "ready") return "MP4已生成";
  if (mp4State === "running") return "成片生成中";
  if (mp4State === "failed") return "成片失败";
  if (videoProject) return "可编辑";
  return null;
}

function inferLibraryCategory(asset: ContentAsset): string {
  const text = `${asset.content_type} ${asset.title} ${asset.body ?? ""}`.toLowerCase();
  if (asset.asset_kind === "asset") return inferAssetSourceCategory(asset);
  if (asset.asset_kind === "copy") {
    if (asset.content_type === "content_plan" || /选题|方案|内容方案|选题方案/.test(text)) return "选题方案";
    if (asset.content_type === "short_video_narration" || /配音|口播|旁白|voiceover/.test(text)) return "配音稿";
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
  const status = videoProjectStatusLabel(asset) ?? statusLabel(asset.status);
  const sourceUrl = typeof asset.metadata?.source_url === "string" ? asset.metadata.source_url : undefined;
  const visual = asset.metadata?.visual && typeof asset.metadata.visual === "object" ? asset.metadata.visual as Record<string, unknown> : {};
  const visualTags = Array.isArray(asset.metadata?.visual_tags)
    ? asset.metadata.visual_tags.map((item) => String(item))
    : Array.isArray(visual.tags)
      ? visual.tags.map((item) => String(item))
      : [];
  const visualCaption = typeof visual.caption === "string" ? visual.caption : undefined;
  const licenseLabel = typeof asset.metadata?.license_label === "string" ? asset.metadata.license_label : undefined;
  return {
    assetId: asset.id,
    title: asset.title,
    meta: asset.asset_kind === "asset" ? `${contentTypeLabel(asset)} · ${status}` : `${category} · ${status}`,
    note: visualCaption || (asset.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "（无摘要）",
    kind: libraryRowKind(asset),
    category,
    keywords: inferKeywords(asset),
    body: (asset.body ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).slice(0, 4),
    contentType: contentTypeLabel(asset),
    statusLabel: status,
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

function createMockAssetWorkspaceAdapter(data: AssetWorkspaceData): AssetWorkspaceAdapter {
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
      return {
        version: product.version ?? "v1",
        savedAt: new Date().toISOString()
      };
    },
    isBackendEnabled() {
      return isApiConfigured;
    },
    async loadConversations(token, current) {
      const rows = await api<AssetConversationResponse[]>("/assets/conversations", token);
      return mergePersistedConversations(rows, current, data.newConversation.product);
    },
    async createConversation(token) {
      const row = await api<AssetConversationResponse>("/assets/conversations", token, { method: "POST" });
      return conversationFromPersisted(row, data.newConversation.product);
    },
    async sendMessage({ token, conversationId, instruction, selectedProductId, linkedAssetIds, signal }) {
      const response = await api<AssetConversationMessageResponse>("/assets/conversations/messages", token, {
        method: "POST",
        signal,
        body: JSON.stringify({
          instruction,
          conversation_id: conversationId === "new" || conversationId.startsWith("draft-") ? undefined : conversationId,
          selected_product_id: selectedProductId,
          linked_asset_ids: linkedAssetIds ?? []
        })
      });
      const generatedProduct = response.product ? contentAssetToProduct(response.product) : undefined;
      const conversation = conversationFromPersisted(response.conversation, data.newConversation.product, generatedProduct);
      const product = generatedProduct ?? null;
      return { conversationId: response.conversation_id, conversation, product };
    },
    async reviseProduct({ token, product, instruction, conversationId, signal }) {
      if (isApiConfigured && token && product.backendAssetId) {
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
      }
      const nextVersion = product.version ? `v${parseInt(product.version.replace("v", ""), 10) + 1}` : "v2";
      return {
        product: {
          ...product,
          version: nextVersion,
          body: [...(product.body ?? [product.summary]), "", `修订指令：${instruction}`],
          status: "本地修订"
        },
        assistantMessage: "已在本地 mock 中记录修订。",
        suggestions: product.actions,
        suggestionActions: undefined,
        diffSummary: "Local mock revision"
      };
    },
    async restoreProductVersion({ token, product, versionId }) {
      if (isApiConfigured && token && product.backendAssetId) {
        const response = await api<ContentAssetRevisionResponse>(`/assets/${product.backendAssetId}/versions/${encodeURIComponent(versionId)}/restore`, token, {
          method: "POST"
        });
        return {
          product: contentAssetToProduct(response.asset),
          assistantMessage: response.assistant_message,
          diffSummary: response.diff_summary
        };
      }
      return {
        product: {
          ...product,
          version: product.versions?.find((version) => version.id === versionId)?.label ?? product.version
        },
        assistantMessage: "已在本地 mock 中恢复版本。",
        diffSummary: "Local mock restore"
      };
    },
    async generateVideo(token, topic, opts) {
      const body = {
        topic,
        language: opts?.language ?? "zh-CN",
        layout: opts?.layout ?? "portrait",
        target_seconds: opts?.targetSeconds ?? 60,
      };
      const raw = await api<{ id: string; asset_id: number; status: string; render_stage: string; error_message: string | null; project: Record<string, unknown> | null }>("/video/generate", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { id: raw.id, assetId: raw.asset_id, status: raw.status, renderStage: raw.render_stage, errorMessage: raw.error_message, project: raw.project };
    },
    async getVideoJob(token, jobId) {
      const raw = await api<{ id: string; asset_id: number; status: string; render_stage: string; error_message: string | null; project: Record<string, unknown> | null }>(`/video/jobs/${encodeURIComponent(jobId)}`, token);
      return { id: raw.id, assetId: raw.asset_id, status: raw.status, renderStage: raw.render_stage, errorMessage: raw.error_message, project: raw.project };
    },
    async retryVideoJob(token, jobId) {
      const raw = await api<{ id: string; asset_id: number; status: string; render_stage: string; error_message: string | null; project: Record<string, unknown> | null }>(`/video/jobs/${encodeURIComponent(jobId)}/retry`, token, {
        method: "POST",
      });
      return { id: raw.id, assetId: raw.asset_id, status: raw.status, renderStage: raw.render_stage, errorMessage: raw.error_message, project: raw.project };
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
      const rows = await api<ContentAsset[]>("/assets", token);
      return rows
        .filter((asset) => kinds.includes(asset.asset_kind))
        .map((asset) => contentAssetToLibraryRow(asset));
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
    async regenerateImageCaption(token, assetId) {
      return api<ContentAsset>(`/assets/${assetId}/caption`, token, { method: "POST" });
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

export const assetWorkspaceAdapter = createMockAssetWorkspaceAdapter(mockAssetWorkspaceData);
