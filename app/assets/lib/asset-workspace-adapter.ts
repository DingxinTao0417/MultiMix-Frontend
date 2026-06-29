import { mockAssetWorkspaceData } from "./asset-workspace-mock-data";
import type { AssetConversation, AssetProduct, AssetSource, AssetWorkspaceData, AssetWorkspaceView, AssetWorkshop } from "./asset-workspace-types";
import {
  api,
  apiForm,
  isApiConfigured,
  type AssetConversationMessageResponse,
  type AssetConversationResponse,
  type ContentAsset,
  type VideoRenderJobCreateResponse
} from "../../../lib/api";
import { conversationFromPersisted, contentAssetToProduct, mergePersistedConversations } from "../../../lib/asset-mappers";

export type LibraryRow = {
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
  detailLabel?: string;
  variant?: "digital-human" | "standard";
};

export type AssetWorkspaceAdapter = {
  getSnapshot(): AssetWorkspaceData;
  listConversations(): AssetConversation[];
  getConversation(conversationId: string): AssetConversation | undefined;
  getNewConversation(): AssetConversation;
  listConversationProducts(conversation: AssetConversation): AssetProduct[];
  getConversationProduct(conversation: AssetConversation, productId?: string): AssetProduct | null;
  getWorkshop(view: Exclude<AssetWorkspaceView, "conversation">): AssetWorkshop;
  listSources(): AssetSource[];
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
    signal?: AbortSignal;
  }): Promise<{ conversationId: string; conversation: AssetConversation; product: AssetProduct | null }>;
  renderVideo(token: string, backendAssetId: number): Promise<{ product: AssetProduct }>;
  generateVideo(token: string, topic: string, opts?: { language?: string; layout?: string; targetSeconds?: number }): Promise<VideoJobResult>;
  getVideoJob(token: string, jobId: string): Promise<VideoJobResult>;
  listLibrary(token: string, view: Exclude<AssetWorkspaceView, "conversation">): Promise<LibraryRow[]>;
  uploadAsset(token: string, file: File, view: Exclude<AssetWorkspaceView, "conversation">): Promise<ContentAsset>;
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
  const fallback: Record<LibraryRow["kind"], string[]> = {
    copy: ["文案", "可复用", "已归档"],
    image: ["图片", "视觉素材", "可检索"],
    video: ["视频", "口播", "可复用"],
    file: ["资料", "来源", "可检索"]
  };
  return [...matched, ...fallback[libraryRowKind(asset)]].filter((keyword, index, array) => array.indexOf(keyword) === index).slice(0, 5);
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

function statusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "ready") return "已入库";
  if (normalized === "processing") return "解析中";
  if (normalized === "failed") return "解析失败";
  if (normalized === "draft") return "待解析";
  if (normalized === "archived") return "已归档";
  return status;
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
    if (asset.content_type === "digital_human_video" || /数字人|avatar|talking head/i.test(text)) return "数字人视频";
    if (asset.content_type === "mg_animation_video" || /mg|动画|motion/.test(text)) return "MG动画视频";
    if (asset.content_type === "real_scene_video" || /实景|拍摄|真人|出镜/.test(text)) return "实景拍摄视频";
    if (asset.content_type === "generated_video" || /生成视频|文生视频|text-to-video/.test(text)) return "生成视频素材";
    return "混剪视频";
  }
  return "资料";
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
    listSources() {
      return data.sources;
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
    async sendMessage({ token, conversationId, instruction, selectedProductId, signal }) {
      const response = await api<AssetConversationMessageResponse>("/assets/conversations/messages", token, {
        method: "POST",
        signal,
        body: JSON.stringify({
          instruction,
          conversation_id: conversationId === "new" ? undefined : conversationId,
          selected_product_id: selectedProductId
        })
      });
      const generatedProduct = response.product ? contentAssetToProduct(response.product) : undefined;
      const conversation = conversationFromPersisted(response.conversation, data.newConversation.product, generatedProduct);
      const product = generatedProduct ?? null;
      return { conversationId: response.conversation_id, conversation, product };
    },
    async renderVideo(token, backendAssetId) {
      const response = await api<VideoRenderJobCreateResponse>(`/assets/videos/${backendAssetId}/render`, token, {
        method: "POST"
      });
      return { product: contentAssetToProduct(response.render_product ?? response.product) };
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
    async listLibrary(token, view) {
      const kinds = libraryKindsForView(view);
      const rows = await api<ContentAsset[]>("/assets", token);
      return rows
        .filter((asset) => kinds.includes(asset.asset_kind))
        .map((asset) => ({
          title: asset.title,
          meta: asset.asset_kind === "asset" ? `${contentTypeLabel(asset)} · ${statusLabel(asset.status)}` : `${inferLibraryCategory(asset)} · ${asset.status}`,
          note: (asset.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "（无摘要）",
          kind: libraryRowKind(asset),
          category: inferLibraryCategory(asset),
          keywords: inferKeywords(asset),
          body: (asset.body ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).slice(0, 4),
          contentType: contentTypeLabel(asset),
          statusLabel: statusLabel(asset.status),
          sourceLabel: asset.source_filename ?? asset.original_ref ?? asset.markdown_ref ?? "对话或系统沉淀",
          variant: /数字人|avatar|talking head/i.test(`${asset.title} ${asset.body ?? ""}`) ? "digital-human" : "standard"
        }));
    },
    async uploadAsset(token, file, view) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("target_kind", view === "assets" ? "asset" : view);
      return apiForm<ContentAsset>("/assets/upload", token, formData);
    }
  };
}

export const assetWorkspaceAdapter = createMockAssetWorkspaceAdapter(mockAssetWorkspaceData);
