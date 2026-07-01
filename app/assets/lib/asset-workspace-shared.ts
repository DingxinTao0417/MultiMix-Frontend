import type { AssetConversation, AssetProduct, AssetProductMode, AssetWorkspaceView } from "./asset-workspace-types";

// Local aliases keep component signatures short and stable across files.
export type ActiveView = AssetWorkspaceView;
export type ProductMode = AssetProductMode;
export type ProductArtifact = AssetProduct;
export type Conversation = AssetConversation;

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
