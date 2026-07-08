import { describe, expect, it } from "vitest";
import { libraryCategoryForAsset } from "../lib/asset-workspace-adapter";
import type { ContentAsset } from "../../../lib/api";

function asset(overrides: Partial<ContentAsset>): ContentAsset {
  return {
    id: 1,
    project_id: null,
    parent_asset_id: null,
    library_kind: "assets",
    asset_kind: "asset",
    content_type: "knowledge",
    title: "内容生成执行层商业计划书.multiMix定位版",
    status: "ready",
    source_type: "upload",
    generation_state: "source_ready",
    source_filename: "内容生成执行层商业计划书.multiMix定位版.pptx",
    source_content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    original_ref: null,
    markdown_ref: null,
    content_hash: null,
    body: "# 内容生成执行层商业计划书\n\n这里包含对话式 Agent 的说明。",
    metadata: {},
    source_mapping: [],
    linked_asset_ids: [],
    linked_event_ids: [],
    archived: false,
    error_message: null,
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    versions: [],
    ...overrides
  };
}

describe("asset workspace category inference", () => {
  it("keeps uploaded PPT assets in 上传资料 even when the body mentions 对话", () => {
    expect(libraryCategoryForAsset(asset({}))).toBe("上传资料");
  });

  it("treats chat uploads as 对话沉淀", () => {
    expect(libraryCategoryForAsset(asset({
      source_type: "chat_upload"
    }))).toBe("对话沉淀");
  });

  it("treats web captures as 采集资料", () => {
    expect(libraryCategoryForAsset(asset({
      source_type: "web_capture"
    }))).toBe("采集资料");
  });
});
