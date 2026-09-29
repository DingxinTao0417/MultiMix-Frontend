import type { AssetConversation, AssetProduct } from "./asset-workspace-types";

export type ProductSaveFeedback = { version: string; updatedAt?: string };

export function savedVersionForProduct(product: AssetProduct, feedback?: ProductSaveFeedback) {
  return product.backendUpdatedAt && product.backendUpdatedAt === feedback?.updatedAt
    && product.version === feedback?.version ? feedback.version : undefined;
}

export function reconcileSavedProduct(
  current: AssetConversation[], conversationId: string, base: AssetProduct, saved: AssetProduct,
): AssetConversation[] {
  if (!base.backendUpdatedAt || saved.id !== base.id || saved.backendAssetId !== base.backendAssetId) return current;
  const conversation = current.find((item) => item.id === conversationId);
  if (!conversation) return current;
  const products = conversation.products?.length ? conversation.products : [conversation.product];
  const latest = products.find((item) => item.id === base.id);
  if (latest?.backendUpdatedAt !== base.backendUpdatedAt) return current;
  return current.map((item) => item.id !== conversationId ? item : {
    ...item,
    product: item.product.id === saved.id ? saved : item.product,
    products: products.map((product) => product.id === saved.id ? saved : product),
    canvasTitle: item.product.id === saved.id ? saved.title : item.canvasTitle,
    canvasMeta: item.product.id === saved.id ? `${saved.status} · ${saved.ratio}` : item.canvasMeta,
    raw: item.product.id === saved.id ? saved.markdownBody ?? saved.body?.join("\n\n") ?? saved.summary : item.raw,
  });
}

export async function runExclusiveProductSave(
  inFlight: Set<string>, productId: string, operation: () => Promise<void>,
): Promise<boolean> {
  if (inFlight.has(productId)) return false;
  inFlight.add(productId);
  try {
    await operation();
    return true;
  } finally {
    inFlight.delete(productId);
  }
}
