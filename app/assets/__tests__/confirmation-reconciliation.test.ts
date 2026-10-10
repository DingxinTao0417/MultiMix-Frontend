import { describe, expect, it } from "vitest";

import {
  buildVideoParameterConfirmationHeaders,
  buildConversationMessagePayload,
} from "../lib/asset-workspace-adapter";


describe("video confirmation transport reconciliation", () => {
  it.each([true, false, undefined])("preserves subtitle choice %s in JSON and recovery headers", (enabled) => {
    const confirmation = {
      pendingIntentId: "subtitle-pending", version: 2, ratio: "16:9", targetSeconds: 30,
      aiVoiceEnabled: false,
      ...(typeof enabled === "boolean" ? { subtitlesEnabled: enabled } : {}),
    };
    const payload = buildConversationMessagePayload({
      conversationId: "subtitle-conversation", instruction: "确认参数并生成编导稿",
      videoParameterConfirmation: confirmation,
    }).video_parameter_confirmation;
    const header = buildVideoParameterConfirmationHeaders(confirmation)["X-MultiMix-Video-Parameter-Confirmation"];
    const recovered = JSON.parse(decodeURIComponent(header.slice(3)));
    expect(recovered).toEqual(payload);
    if (typeof enabled === "boolean") {
      expect(payload).toHaveProperty("subtitles_enabled", enabled);
    } else {
      expect(payload).not.toHaveProperty("subtitles_enabled");
    }
  });

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
        aiVoiceEnabled: true,
      },
    });

    expect(payload.video_parameter_confirmation).toEqual({
      pending_intent_id: "pending-1",
      version: 1,
      ratio: "9:16",
      target_seconds: 45,
      ai_voice_enabled: true,
    });
  });

  it("adds a URL-safe confirmation header without removing the JSON contract", () => {
    expect(buildVideoParameterConfirmationHeaders({
      pendingIntentId: "pending-1",
      version: 1,
      ratio: "9:16",
      targetSeconds: 45,
      aiVoiceEnabled: false,
    })).toEqual({
      "X-MultiMix-Video-Parameter-Confirmation": `v1.${encodeURIComponent(JSON.stringify({
        pending_intent_id: "pending-1",
        version: 1,
        ratio: "9:16",
        target_seconds: 45,
        ai_voice_enabled: false,
      }))}`,
    });
  });

});
