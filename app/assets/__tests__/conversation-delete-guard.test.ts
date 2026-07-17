import { describe, expect, it, vi } from "vitest";

import { runExclusiveConversationDelete } from "../lib/asset-workspace-shared";

describe("runExclusiveConversationDelete", () => {
  it("runs only one delete while the same conversation is already in flight", async () => {
    const inFlight = new Set<string>();
    let finishDelete: (() => void) | undefined;
    const deleteConversation = vi.fn(() => new Promise<void>((resolve) => {
      finishDelete = resolve;
    }));

    const first = runExclusiveConversationDelete(
      inFlight,
      "asset-conversation-519",
      deleteConversation,
    );
    const duplicate = await runExclusiveConversationDelete(
      inFlight,
      "asset-conversation-519",
      deleteConversation,
    );

    expect(duplicate).toBe(false);
    expect(deleteConversation).toHaveBeenCalledOnce();

    finishDelete?.();
    await expect(first).resolves.toBe(true);
  });

  it("releases the guard after a failed delete so a later retry can run", async () => {
    const inFlight = new Set<string>();
    const deleteConversation = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(undefined);

    await expect(runExclusiveConversationDelete(
      inFlight,
      "asset-conversation-519",
      deleteConversation,
    )).rejects.toThrow("network error");
    await expect(runExclusiveConversationDelete(
      inFlight,
      "asset-conversation-519",
      deleteConversation,
    )).resolves.toBe(true);

    expect(deleteConversation).toHaveBeenCalledTimes(2);
  });
});
