import { describe, expect, it } from "vitest";

import { shouldLoadConversationDetail } from "../conversation-detail-load-policy";

describe("shouldLoadConversationDetail", () => {
  it("does not read a client-only optimistic draft from the API", () => {
    expect(
      shouldLoadConversationDetail({
        hasToken: true,
        conversationId: "draft-1785854369630-wzeittgchgk",
        detailsLoaded: false,
      }),
    ).toBe(false);
  });

  it("reads a persisted conversation whose details are not loaded", () => {
    expect(
      shouldLoadConversationDetail({
        hasToken: true,
        conversationId: "asset-conversation-f4fafcc276d3",
        detailsLoaded: false,
      }),
    ).toBe(true);
  });

  it.each([
    { hasToken: false, conversationId: "asset-conversation-1", detailsLoaded: false },
    { hasToken: true, conversationId: "new", detailsLoaded: false },
    { hasToken: true, conversationId: "asset-conversation-1", detailsLoaded: true },
  ])("does not reload an ineligible detail target: %#", (input) => {
    expect(shouldLoadConversationDetail(input)).toBe(false);
  });
});
