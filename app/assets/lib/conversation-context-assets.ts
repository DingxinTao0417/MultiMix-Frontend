export type ConversationContextAsset = {
  id: number;
  title: string;
};

const EXPLICIT_REFERENCE_SELECTION_VERSION = "v1";

type PersistedConversationMessage = {
  role: string;
  metadata?: Record<string, unknown> | null;
};

function positiveAssetIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const candidate of value) {
    if (
      typeof candidate !== "number"
      || !Number.isInteger(candidate)
      || candidate <= 0
      || seen.has(candidate)
    ) continue;
    seen.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

/**
 * Rehydrates only a source the user explicitly included in a previous turn.
 * Project resources and generated products deliberately do not participate:
 * their presence is not consent to use them as this request's reference input.
 */
export function persistedConversationContextAssets(
  messages: readonly PersistedConversationMessage[],
): ConversationContextAsset[] {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (message.metadata?.reference_context_selection_version !== EXPLICIT_REFERENCE_SELECTION_VERSION) {
      continue;
    }
    const ids = positiveAssetIds(message.metadata?.linked_asset_ids);
    if (ids === null) continue;
    return ids.map((id) => ({ id, title: `素材 #${id}` }));
  }
  return [];
}

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
