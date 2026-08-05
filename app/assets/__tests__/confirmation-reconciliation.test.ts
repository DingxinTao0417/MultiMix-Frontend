import { describe, expect, it } from "vitest";

import {
  buildVideoParameterConfirmationHeaders,
  buildConversationMessagePayload,
  findConversationByClientRequestId,
} from "../lib/asset-workspace-adapter";
import type { AssetConversationResponse } from "../../../lib/api";


describe("video confirmation transport reconciliation", () => {
  it("sends the stable client request id in the conversation payload", () => {
    const payload = buildConversationMessagePayload({
      conversationId: "asset-conversation-450",
      instruction: "确认，生成视频工程（横屏 16:9）",
      selectedProductId: 450,
      linkedAssetIds: [],
      clientRequestId: "13c3b93f-d5fa-4a9c-8f9d-38e62829498d",
    });

    expect(payload).toEqual({
      instruction: "确认，生成视频工程（横屏 16:9）",
      conversation_id: "asset-conversation-450",
      selected_product_id: 450,
      linked_asset_ids: [],
      client_request_id: "13c3b93f-d5fa-4a9c-8f9d-38e62829498d",
    });
  });

  it("sends video parameter confirmation as structured payload", () => {
    const payload = buildConversationMessagePayload({
      conversationId: "asset-conversation-451",
      instruction: "确认参数并生成编导稿",
      videoParameterConfirmation: {
        pendingIntentId: "pending-1",
        version: 1,
        ratio: "9:16",
        targetSeconds: 45,
      },
    });

    expect(payload.video_parameter_confirmation).toEqual({
      pending_intent_id: "pending-1",
      version: 1,
      ratio: "9:16",
      target_seconds: 45,
    });
  });

  it("adds a URL-safe confirmation header without removing the JSON contract", () => {
    expect(buildVideoParameterConfirmationHeaders({
      pendingIntentId: "pending-1",
      version: 1,
      ratio: "9:16",
      targetSeconds: 45,
    })).toEqual({
      "X-MultiMix-Video-Parameter-Confirmation": `v1.${encodeURIComponent(JSON.stringify({
        pending_intent_id: "pending-1",
        version: 1,
        ratio: "9:16",
        target_seconds: 45,
      }))}`,
    });
  });

  it("finds a server-committed conversation by client request id", () => {
    const rows = [{
      id: "asset-conversation-450",
      title: "30秒短视频",
      status: "active",
      metadata: { video_workflow_stage: "video_project_queued" },
      messages: [{
        id: 1,
        role: "user",
        text: "确认，生成视频工程（横屏 16:9）",
        asset_id: null,
        metadata: { client_request_id: "request-1" },
        created_at: "2026-07-10T00:00:00Z",
      }],
      products: [],
      created_at: "2026-07-10T00:00:00Z",
      updated_at: "2026-07-10T00:00:00Z",
    }] as AssetConversationResponse[];

    expect(findConversationByClientRequestId(rows, "request-1")?.id).toBe("asset-conversation-450");
    expect(findConversationByClientRequestId(rows, "missing")).toBeNull();
  });
});
