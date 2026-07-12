import { describe, expect, it, vi } from "vitest";
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
  it("loads saved material recommendations and the understood media library independently", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("asset-suggestions")) {
        return new Response(JSON.stringify({ suggestions: [{
          asset_id: 12,
          title: "施工过程记录",
          preview_url: "local://施工.jpg",
          match_reason: "匹配施工过程",
        }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("kind=image")) {
        return new Response(JSON.stringify([asset({ id: 21, asset_kind: "image", original_ref: "local://图片.jpg", title: "门店图片" })]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("kind=video")) {
        return new Response(JSON.stringify([asset({ id: 22, asset_kind: "video", original_ref: "https://example.com/video.mp4", title: "门店视频" })]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await assetWorkspaceAdapter.loadSegmentMaterialOptions("token", 9100, "segment-1");

    expect(result.recommended).toEqual([expect.objectContaining({ id: "12", title: "施工过程记录", reason: "匹配施工过程" })]);
    expect(result.library.map((item) => item.title)).toEqual(["门店图片", "门店视频"]);
    expect(result.library[0]?.thumbnailUrl).toContain("/v1/video/media?ref=");
    vi.unstubAllGlobals();
  });

  it("preserves the timeline dirty confirmation contract for browse replacement", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { code: "timeline_dirty", message: "会覆盖手工剪辑" } }), { status: 409, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-recompose", asset_id: 9100, status: "queued", render_stage: "queued", error_message: null, project: null }), { status: 202, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", 12)).resolves.toEqual({
      kind: "confirm_overwrite",
      message: "会覆盖手工剪辑",
    });
    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", 12, true)).resolves.toMatchObject({
      kind: "started",
      job: { id: "job-recompose" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ confirm_overwrite: true });
    vi.unstubAllGlobals();
  });

  it("correlates a confirmation request with the client request id header", async () => {
    const clientRequestId = "13c3b93f-d5fa-4a9c-8f9d-38e62829498d";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        detail: "数据库暂时不可用，请稍后重试。",
        code: "database_temporarily_unavailable",
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(assetWorkspaceAdapter.sendMessage({
      token: "token",
      conversationId: "asset-conversation-450",
      instruction: "确认，生成视频工程（横屏 16:9）",
      selectedProductId: 450,
      clientRequestId,
    })).rejects.toThrow("MULTIMIX_API_CONNECTION_ERROR");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Request-ID": clientRequestId,
    });
    vi.unstubAllGlobals();
  });

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
