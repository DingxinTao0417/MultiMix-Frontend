import { describe, expect, it } from "vitest";

import { mergeConversationContextAssets } from "../lib/conversation-context-assets";

describe("conversation context asset merging", () => {
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
});
