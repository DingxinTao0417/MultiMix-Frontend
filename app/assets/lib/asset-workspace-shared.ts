import type { AssetConversation, AssetProduct, AssetProductMode, AssetWorkspaceView } from "./asset-workspace-types";

// Local aliases keep component signatures short and stable across files.
export type ActiveView = AssetWorkspaceView;
export type ProductMode = AssetProductMode;
export type ProductArtifact = AssetProduct;
export type Conversation = AssetConversation;

export function getConversationProducts(conversation: Conversation) {
  return conversation.products && conversation.products.length > 0 ? conversation.products : [conversation.product];
}

export function resolveConversationProduct(conversation: Conversation, selectedProductId: string | undefined) {
  const products = getConversationProducts(conversation);
  return products.find((product) => product.id === selectedProductId) ?? products[products.length - 1] ?? conversation.product;
}

export function getProductModeLabel(mode: ProductMode) {
  if (mode === "copy") return "文案";
  if (mode === "image") return "图片";
  if (mode === "audio") return "音频";
  if (mode === "digital-human") return "数字人视频";
  return "视频";
}

export function getProductRatioClass(ratio: string) {
  if (ratio.includes("16:9")) return "ratio-landscape";
  if (ratio.includes("9:16")) return "ratio-portrait";
  if (ratio.includes("4:5")) return "ratio-cover";
  return "";
}
