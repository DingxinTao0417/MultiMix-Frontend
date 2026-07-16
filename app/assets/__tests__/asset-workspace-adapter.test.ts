import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assetWorkspaceAdapter, conversationFromSummary, libraryCategoryForAsset, retryConversationDetailLoad } from "../lib/asset-workspace-adapter";
import type { AssetConversationSummaryResponse, ContentAsset } from "../../../lib/api";
import type { AssetProduct } from "../lib/asset-workspace-types";

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
  it("saves text edits through the guarded text-edit endpoint", async () => {
    const updated = asset({
      id: 88,
      asset_kind: "copy",
      content_type: "social_post",
      content_hash: "new-hash",
      body: "# 新文案\n\n已修改正文",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assetWorkspaceAdapter.saveTextEdit({
      token: "token",
      product: {
        backendAssetId: 88,
        contentHash: "old-hash",
      } as AssetProduct,
      body: "# 新文案\n\n已修改正文",
      acceptStructuralChange: false,
    });

    expect(result.kind).toBe("saved");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/assets/88/text-edits"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "# 新文案\n\n已修改正文",
          base_content_hash: "old-hash",
          accept_structural_change: false,
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

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

  it("maps unified local candidates into current/recommended/library groups", async () => {
    const candidate = (overrides: Record<string, unknown>) => ({
      candidate_id: "cand-1",
      source_type: "saved_asset",
      source_asset_id: 12,
      provider: "library",
      provider_item_id: "12",
      media_type: "image",
      title: "施工过程记录",
      preview_url: "https://cdn/preview.jpg",
      width: 1080,
      height: 1920,
      duration: 0,
      license: "",
      author: "",
      attribution_url: "",
      verification_status: "persisted",
      relevance_status: "recommended",
      relevance_reason: "匹配施工过程",
      requires_trim: false,
      already_persisted: true,
      selectable: true,
      ...overrides,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        scope: "local",
        segment_id: "segment-1",
        groups: {
          current: [candidate({ candidate_id: "cur-1", relevance_status: "current", selectable: false })],
          recommended: [candidate({})],
          library: [candidate({ candidate_id: "cand-2", source_asset_id: 13, relevance_status: "related" })],
          public: [],
        },
        provider_statuses: [],
        next_cursor: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assetWorkspaceAdapter.loadSegmentMaterialCandidates("token", 9100, "segment-1", "local");

    expect(result.v2Disabled).toBeFalsy();
    expect(result.current?.[0]).toMatchObject({ candidateId: "cur-1", selectable: false });
    expect(result.recommended[0]).toMatchObject({ candidateId: "cand-1", assetId: 12, reason: "匹配施工过程" });
    expect(result.library[0]).toMatchObject({ candidateId: "cand-2" });
    vi.unstubAllGlobals();
  });

  it("flags the v2 candidate endpoint as disabled on 404 so callers can fall back", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Segment material candidates v2 is disabled." }), { status: 404, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assetWorkspaceAdapter.loadSegmentMaterialCandidates("token", 9100, "segment-1", "local");

    expect(result.v2Disabled).toBe(true);
    expect(result.recommended).toEqual([]);
    expect(result.library).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("returns public candidates with provider statuses and next cursor", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        scope: "public",
        segment_id: "segment-1",
        groups: {
          current: [],
          recommended: [],
          library: [],
          public: [{
            candidate_id: "pub-1",
            source_type: "public_asset",
            source_asset_id: null,
            provider: "pexels",
            provider_item_id: "9988",
            media_type: "video",
            title: "门店安装",
            preview_url: "https://cdn/pub.jpg",
            width: 1080,
            height: 1920,
            duration: 8,
            license: "Pexels License",
            author: "Jane",
            attribution_url: "https://pexels/9988",
            verification_status: "unverified",
            relevance_status: "unverified",
            relevance_reason: "由结构化搜索召回",
            requires_trim: true,
            already_persisted: false,
            selectable: true,
          }],
        },
        provider_statuses: [{ provider: "pexels", status: "ok", error: "" }],
        next_cursor: "cursor-2",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assetWorkspaceAdapter.loadSegmentMaterialCandidates("token", 9100, "segment-1", "public");

    expect(result.public?.[0]).toMatchObject({ candidateId: "pub-1", provider: "pexels", requiresTrim: true, mediaType: "video" });
    expect(result.providerStatuses).toEqual([{ provider: "pexels", status: "ok", error: undefined }]);
    expect(result.publicNextCursor).toBe("cursor-2");
    vi.unstubAllGlobals();
  });

  it("submits candidate_id when replacing with a unified candidate", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "job-1", asset_id: 9100, status: "queued", render_stage: "queued", error_message: null, project: null }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", { candidateId: "cand-9" })).resolves.toMatchObject({
      kind: "started",
      job: { id: "job-1" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ operation: "replace_material", candidate_id: "cand-9" });
    vi.unstubAllGlobals();
  });

  it("preserves the timeline dirty confirmation contract for browse replacement", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { code: "timeline_dirty", message: "会覆盖手工剪辑" } }), { status: 409, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-recompose", asset_id: 9100, status: "queued", render_stage: "queued", error_message: null, project: null }), { status: 202, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", { assetId: 12 })).resolves.toEqual({
      kind: "confirm_overwrite",
      message: "会覆盖手工剪辑",
    });
    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", { assetId: 12 }, true)).resolves.toMatchObject({
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
