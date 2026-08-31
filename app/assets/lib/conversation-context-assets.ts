export type ConversationContextAsset = {
  id: number;
  title: string;
};

export function mergeConversationContextAssets(
  current: ConversationContextAsset[],
  additions: ConversationContextAsset[],
  limit = 8,
): ConversationContextAsset[] {
  const byId = new Map<number, ConversationContextAsset>();
  for (const item of [...current, ...additions]) {
    byId.delete(item.id);
    byId.set(item.id, item);
  }
  return [...byId.values()].slice(-limit);
}
