export type ConversationDetailLoadTarget = {
  hasToken: boolean;
  conversationId: string;
  detailsLoaded: boolean;
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
