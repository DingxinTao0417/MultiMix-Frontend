import type { AssetConversation, AssetProduct, AssetProductMode, AssetWorkspaceView } from "./asset-workspace-types";

// Local aliases keep component signatures short and stable across files.
export type ActiveView = AssetWorkspaceView;
export type ProductMode = AssetProductMode;
export type ProductArtifact = AssetProduct;

export async function runExclusiveConversationDelete(
  inFlightConversationIds: Set<string>,
  conversationId: string,
  operation: () => Promise<void>,
): Promise<boolean> {
  if (inFlightConversationIds.has(conversationId)) return false;
  inFlightConversationIds.add(conversationId);
  try {
    await operation();
    return true;
  } finally {
    inFlightConversationIds.delete(conversationId);
  }
}
export type Conversation = AssetConversation;

// Type guards for untyped JSON payloads (backend metadata, video_project blobs).
// Note: this stringValue does NOT trim; the adapter keeps its own trimming variant.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function getConversationProducts(conversation: Conversation) {
  const products = conversation.products && conversation.products.length > 0 ? conversation.products : [conversation.product];
  return products.filter((product) => !isPlaceholderProduct(product));
}

export function resolveConversationProduct(conversation: Conversation, selectedProductId: string | undefined) {
  const products = getConversationProducts(conversation);
  return products.find((product) => product.id === selectedProductId) ?? products[products.length - 1] ?? null;
}

export function isPlaceholderProduct(product: ProductArtifact | null | undefined) {
  return !product || product.id === "empty-product" || product.status === "等待指令";
}

export function shouldReviseSelectedProduct(
  instruction: string,
  product: { backendAssetId?: number } | null,
): boolean {
  if (!product?.backendAssetId) return false;
  const text = instruction.trim().toLowerCase();
  if (!text) return false;
  if (/(mp4|成片|渲染|导出视频|render|export)/i.test(text)) return false;
  if (/(再做|另外|新增|新建|再生成|另做|add another|new one|create another)/i.test(text)) return false;
  if (/(基于|做成|变成|转成|turn into|make it).*(文案|图片|图|视频|copy|image|video)/i.test(text)) return false;

  const explicitEditAction = /(修改|调整|改成|改为|改得|改写|重写|优化|润色|缩短|压到|扩写|提炼|删掉|删除|替换|换成|保留|shorten|revise|rewrite|edit|change|adjust|optimize)/i;
  if (explicitEditAction.test(text)) return true;

  const readOnlyQuestion = /[?？]|(是什么|说了什么|为什么|怎么安排|如何安排|是不是|有没有|多少|几段|几镜|吗|呢)$/i;
  if (readOnlyQuestion.test(text)) return false;

  return /(短一点|更短|更口语|更专业|构图更|色调更)/i.test(text);
}

export function getProductModeLabel(mode: ProductMode) {
  if (mode === "copy") return "文案";
  if (mode === "image") return "图片";
  if (mode === "audio") return "音频";
  if (mode === "digital-human") return "数字人视频";
  if (mode === "mg_animation_video") return "MG 动效";
  return "视频";
}

export function getProductRatioClass(ratio: string) {
  if (ratio.includes("16:9")) return "ratio-landscape";
  if (ratio.includes("9:16")) return "ratio-portrait";
  if (ratio.includes("4:5")) return "ratio-cover";
  return "";
}

// Minimal shape of a chat composer attachment, mirrored from ChatImageAttachment
// in conversation-studio.tsx. Kept local so both composers can share the send
// guard without a component <-> lib import cycle.
type AttachmentState = {
  status: "uploading" | "processing" | "ready" | "failed";
};

// Whether the composer should refuse to send because attachments are not yet
// usable. An upload that failed (e.g. storage timeout) or is still in flight has
// no backend asset id, so sending would drop the material silently and the agent
// would answer as if no source was ever provided. Returns a user-facing reason to
// show, or null when sending is safe.
export function attachmentSendBlockReason(attachments: readonly AttachmentState[]): string | null {
  if (!attachments.length) return null;
  if (attachments.some((attachment) => attachment.status === "failed")) {
    return "有素材上传失败，请点“重试”或移除后再发送。";
  }
  if (attachments.some((attachment) => attachment.status === "uploading" || attachment.status === "processing")) {
    return "素材还在上传/解析中，等它就绪后再发送，AI 才能基于它创作。";
  }
  return null;
}
