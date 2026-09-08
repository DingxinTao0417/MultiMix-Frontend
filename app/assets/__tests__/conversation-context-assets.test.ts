import { describe, expect, it } from "vitest";

import {
  mergeConversationContextAssets,
  persistedConversationContextAssets,
} from "../lib/conversation-context-assets";

describe("conversation context assets", () => {
  it("keeps saved video context when fresh image and document attachments are sent", () => {
    const merged = mergeConversationContextAssets(
      [{ id: 11, title: "已保存视频" }],
      [
        { id: 22, title: "新上传图片" },
        { id: 33, title: "新上传文档" },
      ],
    );

    expect(merged.map((asset) => asset.id)).toEqual([11, 22, 33]);
  });

  it("deduplicates by asset id, keeps the newest title, and preserves the eight-item limit", () => {
    const current = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      title: `已有素材 ${index + 1}`,
    }));

    const merged = mergeConversationContextAssets(current, [
      { id: 8, title: "更新后的第八项" },
      { id: 9, title: "新增第九项" },
    ]);

    expect(merged).toHaveLength(8);
    expect(merged.map((asset) => asset.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(merged.find((asset) => asset.id === 8)?.title).toBe("更新后的第八项");
  });

  it("restores only the latest explicitly linked user assets after reload", () => {
    const assets = persistedConversationContextAssets([
      { role: "user", metadata: { reference_context_selection_version: "v1", linked_asset_ids: [11] } },
      { role: "assistant", metadata: { linked_asset_ids: [99] } },
      { role: "user", metadata: { workflow_stage: "agent_user_message" } },
      {
        role: "user",
        metadata: {
          reference_context_selection_version: "v1",
          linked_asset_ids: [21, 22, 21, -1, "invalid"],
        },
      },
    ]);

    expect(assets).toEqual([
      { id: 21, title: "素材 #21" },
      { id: 22, title: "素材 #22" },
    ]);
  });

  it("keeps an explicit empty latest selection empty instead of reviving historical assets", () => {
    expect(persistedConversationContextAssets([
      { role: "user", metadata: { reference_context_selection_version: "v1", linked_asset_ids: [11] } },
      { role: "user", metadata: { reference_context_selection_version: "v1", linked_asset_ids: [] } },
    ])).toEqual([]);
  });

  it("does not revive unversioned historical linked assets", () => {
    expect(persistedConversationContextAssets([
      { role: "user", metadata: { linked_asset_ids: [11, 12] } },
    ])).toEqual([]);
  });
});
