export type ConversationDetailLoadTarget = {
  hasToken: boolean;
  conversationId: string;
  detailsLoaded: boolean;
};

type ConversationDetailRow = {
  id: string;
  detailsLoaded?: boolean;
};

export function shouldLoadConversationDetail({
  hasToken,
  conversationId,
  detailsLoaded,
}: ConversationDetailLoadTarget): boolean {
  return hasToken
    && conversationId !== "new"
    && !conversationId.startsWith("draft-")
    && !detailsLoaded;
}

export function shouldRestoreInitialConversationFocus({
  pendingConversationId,
  routeConversationId,
  initialConversationId,
  selectedConversationId,
  summaryIds,
}: {
  pendingConversationId: string | null;
  routeConversationId: string | null;
  initialConversationId: string | undefined;
  selectedConversationId: string;
  summaryIds: Iterable<string>;
}): boolean {
  return !pendingConversationId
    && routeConversationId === initialConversationId
    && selectedConversationId !== "new"
    && Boolean(initialConversationId)
    && [...summaryIds].includes(initialConversationId!);
}

export function preserveSelectedConversationDetail<T extends ConversationDetailRow>({
  merged,
  current,
  selectedConversationId,
}: {
  merged: T[];
  current: T[];
  selectedConversationId: string;
}): T[] {
  const selectedDetail = current.find((conversation) => (
    conversation.id === selectedConversationId
    && conversation.detailsLoaded === true
  ));
  if (!selectedDetail) return merged;
  return merged.some((conversation) => conversation.id === selectedDetail.id)
    ? merged.map((conversation) => (
      conversation.id === selectedDetail.id ? selectedDetail : conversation
    ))
    : [selectedDetail, ...merged];
}
