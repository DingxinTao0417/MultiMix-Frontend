import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assetWorkspaceAdapter, conversationFromSummary, libraryCategoryForAsset, retryConversationDetailLoad } from "../lib/asset-workspace-adapter";
import type { AssetConversationSummaryResponse, ContentAsset } from "../../../lib/api";

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

describe("runtime data boundary", () => {
  it("retries one transient conversation detail failure", async () => {
    let attempts = 0;
    const result = await retryConversationDetailLoad(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary database connection failure");
      return "loaded";
    }, async () => undefined);

    expect(result).toBe("loaded");
    expect(attempts).toBe(2);
  });

  it("maps lightweight summaries without fabricating messages or products", () => {
    const summary: AssetConversationSummaryResponse = {
      id: "asset-conversation-480",
      title: "MultiMix 产品介绍短视频",
      status: "active",
      metadata: {},
      created_at: "2026-07-12T08:00:00Z",
      updated_at: "2026-07-12T09:00:00Z",
    };

    const conversation = conversationFromSummary(summary, assetWorkspaceAdapter.getNewConversation().product);

    expect(conversation.id).toBe(summary.id);
    expect(conversation.title).toBe(summary.title);
    expect(conversation.detailsLoaded).toBe(false);
    expect(conversation.messages).toEqual([]);
    expect(conversation.products).toEqual([]);
  });

  it("keeps bundled demo data out of the production adapter", () => {
    const source = readFileSync(resolve(process.cwd(), "app/assets/lib/asset-workspace-adapter.ts"), "utf8");

    expect(source).not.toContain("asset-workspace-mock-data");
    expect(source).not.toContain("mockAssetWorkspaceData");
    expect(source).not.toContain("Local mock revision");
    expect(source).not.toContain("Local mock restore");
  });

  it("keeps product starter prompts without restoring demo conversations", () => {
    expect(assetWorkspaceAdapter.listConversations()).toEqual([]);
    expect(assetWorkspaceAdapter.getNewConversation().suggestions).toEqual([
      "写一条小红书文案",
      "生成 9:16 短视频脚本",
      "做一张封面图",
      "把好评截图变成种草帖"
    ]);
  });
});
