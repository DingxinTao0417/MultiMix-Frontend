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
};

export type AssetWorkspaceAdapter = {
  getSnapshot(): AssetWorkspaceData;
  listConversations(): AssetConversation[];
  getConversation(conversationId: string): AssetConversation | undefined;
  getNewConversation(): AssetConversation;
  listConversationProducts(conversation: AssetConversation): AssetProduct[];
  getConversationProduct(conversation: AssetConversation, productId?: string): AssetProduct;
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
  }): Promise<{ conversationId: string; conversation: AssetConversation; product: AssetProduct }>;
  renderVideo(token: string, backendAssetId: number): Promise<{ product: AssetProduct }>;
  generateVideo(token: string, topic: string, opts?: { language?: string; layout?: string; targetSeconds?: number }): Promise<VideoJobResult>;
  getVideoJob(token: string, jobId: string): Promise<VideoJobResult>;
  listLibrary(token: string, view: Exclude<AssetWorkspaceView, "conversation">): Promise<LibraryRow[]>;
  uploadAsset(token: string, file: File): Promise<ContentAsset>;
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
  if (view === "video") return ["video", "video_render", "image"];
  return ["asset"]; // 资产库: uploaded/captured knowledge sources
}

function libraryRowKind(asset: ContentAsset): LibraryRow["kind"] {
  if (asset.asset_kind === "image") return "image";
  if (asset.asset_kind === "video" || asset.asset_kind === "video_render") return "video";
  if (asset.asset_kind === "copy") return "copy";
  return "file";
}

function relativeMeta(asset: ContentAsset): string {
  const kindLabel: Record<string, string> = {
    asset: "知识来源",
    copy: "文案产物",
    video: "视频产物",
    video_render: "成片任务",
    image: "图片产物"
  };
  return `${kindLabel[asset.asset_kind] ?? "产物"} · ${asset.status}`;
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
      const product = contentAssetToProduct(response.product);
      const conversation = conversationFromPersisted(response.conversation, data.newConversation.product, product);
      return { conversationId: response.conversation_id, conversation, product };
    },
    async renderVideo(token, backendAssetId) {
      const response = await api<VideoRenderJobCreateResponse>(`/assets/videos/${backendAssetId}/render`, token, {
        method: "POST"
      });
      return { product: contentAssetToProduct(response.product) };
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
          meta: relativeMeta(asset),
          note: (asset.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "（无摘要）",
          kind: libraryRowKind(asset)
        }));
    },
    async uploadAsset(token, file) {
      const formData = new FormData();
      formData.append("file", file);
      return apiForm<ContentAsset>("/assets/upload", token, formData);
    }
  };
}

export const assetWorkspaceAdapter = createMockAssetWorkspaceAdapter(mockAssetWorkspaceData);
