import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assetWorkspaceAdapter,
  assertVideoWritesAvailable,
  buildConversationMessagePayload,
  conversationFromSummary,
  libraryCategoryForAsset,
  libraryKeywordsForAsset,
  libraryVariantForAsset,
  retryConversationDetailLoad,
} from "../lib/asset-workspace-adapter";
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

  it("does not infer a source category from title or body when source_type is missing", () => {
    expect(libraryCategoryForAsset(asset({
      source_type: undefined,
      title: "对话沉淀的品牌画像",
      body: "来自网页采集和公众号链接",
    }))).toBe("未分类");
  });

  it("does not infer an artifact category from copy text", () => {
    expect(libraryCategoryForAsset(asset({
      asset_kind: "copy",
      content_type: "custom_copy",
      title: "品牌编导脚本与分镜方案",
      body: "包含镜头和导演说明",
      source_type: "conversation",
    }))).toBe("未分类");
  });

  it("maps only explicit artifact fields and deterministic content types", () => {
    expect(libraryCategoryForAsset(asset({
      asset_kind: "copy",
      content_type: "video_script",
    }))).toBe("编导稿");
    expect(libraryCategoryForAsset(asset({
      asset_kind: "image",
      content_type: "storyboard_image",
    }))).toBe("分镜图");
    expect(libraryCategoryForAsset(asset({
      asset_kind: "video",
      content_type: "video_project",
    }))).toBe("视频工程");
    expect(libraryCategoryForAsset(asset({
      asset_kind: "image",
      content_type: "custom_image",
      metadata: { artifact_category: "封面图" },
    }))).toBe("封面图");
  });

  it("uses only backend understanding tags instead of title seeds or generic defaults", () => {
    const keywords = libraryKeywordsForAsset(asset({
      asset_kind: "video",
      content_type: "uploaded_video",
      title: "小红书数字人口播视频",
      metadata: {
        understanding: {
          status: "ready",
          tags: ["工作台", "素材整理"],
          storyboard_roles: [{ code: "process", label: "过程", score: 0.9 }],
          scene_types: [{ code: "workspace", label: "工作场景", score: 0.8 }],
        },
      },
    }));

    expect(keywords).toEqual(["工作台", "素材整理"]);
  });

  it("uses only the explicit backend video mode for the digital-human marker", () => {
    expect(libraryVariantForAsset(asset({
      asset_kind: "video",
      title: "数字人口播视频",
      body: "talking head avatar",
      metadata: {},
    }))).toBe("standard");
    expect(libraryVariantForAsset(asset({
      asset_kind: "video",
      title: "品牌介绍",
      metadata: { video_mode: "digital_human" },
    }))).toBe("digital-human");
  });
});

describe("runtime data boundary", () => {
  it("blocks structured video writes during maintenance without blocking reads", () => {
    expect(() => assertVideoWritesAvailable(true)).toThrow("视频生成与修改暂时维护中");
    expect(() => assertVideoWritesAvailable(false)).not.toThrow();
  });

  it("reads the source excerpt audit with the caller token and maps only its summary", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      asset_id: 1276,
      project_ready: true,
      product_completed: true,
      audit: {
        source_asset_count: 1,
        source_window_duration_seconds: 27,
        retained_range_count: 2,
        retained_duration_seconds: 17,
        removed_range_count: 1,
        removed_duration_seconds: 10,
        has_safe_removal: true,
        source_fingerprint_consistent: true,
        source_audio_visual_subtitle_timeline_consistent: true,
        failure_codes: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const audit = await assetWorkspaceAdapter.getSourceExcerptAudit("token", 1276);
    vi.unstubAllGlobals();

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      "/v1/video/projects/1276/source-excerpt-audit",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
    expect(audit).toMatchObject({
      assetId: 1276,
      audit: { sourceWindowDurationSeconds: 27, removedRangeCount: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain("source_fingerprint");
  });

  it("loads a lightweight conversation snapshot before the full history", async () => {
    const project = asset({
      id: 72,
      asset_kind: "video",
      content_type: "video_project",
      status: "ready",
      product_status: "completed",
      generation_state: "video_project_ready",
      metadata: {
        capability: "video_project",
        orchestration_pending: false,
        video_workflow_stage: "video_project_ready",
        video_project: { timeline: { tracks: [], media: [] } },
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "asset-conversation-snapshot",
      title: "厨房动线与收纳规划",
      status: "active",
      metadata: { video_workflow_stage: "video_project_ready" },
      messages: [],
      products: [project],
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-02T00:01:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await assetWorkspaceAdapter.loadConversationSnapshot(
      "token",
      "asset-conversation-snapshot",
    );
    vi.unstubAllGlobals();

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      "/v1/assets/conversations/asset-conversation-snapshot/snapshot",
    );
    expect(snapshot.detailsLoaded).toBe(false);
    expect(snapshot.product.backendAssetId).toBe(72);
    expect(snapshot.product.productStatus).toBe("completed");
    expect(snapshot.product.status).toBe("完成");
  });

  it("serializes the exact Agent confirmation binding only when provided", () => {
    expect(buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "确认修改",
      agentConfirmationId: "agent-confirm-exact",
    })).toMatchObject({
      conversation_id: "asset-conversation-1",
      agent_confirmation_id: "agent-confirm-exact",
    });

    expect(buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "这个音色偏温暖吗？",
    })).not.toHaveProperty("agent_confirmation_id");
  });

  it("serializes presenter direction as an explicit id instead of embedding it in prose", () => {
    const payload = buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "确认，生成视频工程",
      presenterDirectionConfirmation: {
        directorCandidateId: "direction-b",
        ratio: "9:16",
        subtitleMode: "bilingual",
        targetSeconds: 30,
      },
    });

    expect(payload).toMatchObject({
      instruction: "确认，生成视频工程",
      presenter_direction_confirmation: {
        director_candidate_id: "direction-b",
        ratio: "9:16",
        subtitle_mode: "bilingual",
        target_seconds: 30,
      },
    });
    expect(payload.instruction).not.toContain("direction-b");
  });

  it("serializes presenter audio selection with exact track bindings", () => {
    const payload = buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "确认使用所选原声音轨",
      presenterAudioSelectionConfirmation: {
        confirmationId: "presenter-audio-selection-current",
        audioStreamIndex: 2,
        audioFingerprint: "sha256:audio-2",
        transcriptHash: "sha256:transcript-2",
      },
    });

    expect(payload).toMatchObject({
      presenter_audio_selection_confirmation: {
        confirmation_id: "presenter-audio-selection-current",
        audio_stream_index: 2,
        audio_fingerprint: "sha256:audio-2",
        transcript_hash: "sha256:transcript-2",
      },
    });

    expect(buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "完整保留原意",
      longFormAction: {
        kind: "preserve",
        analysisAssetId: 92,
      },
    })).toMatchObject({
      conversation_id: "asset-conversation-1",
      long_form_action: {
        kind: "preserve",
        analysis_asset_id: 92,
      },
    });
  });

  it("sends the source subtitle choice as structured confirmation data", () => {
    const payload = buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "确认，生成视频工程",
      selectedProductId: 1194,
      sourceSubtitleMode: "translated_zh",
    });
    expect(payload).toMatchObject({
      selected_product_id: 1194,
      source_subtitle_mode: "translated_zh",
    });
    expect(payload.instruction).not.toContain("translated_zh");
  });

  it("serializes long-form actions as structured data", () => {
    expect(buildConversationMessagePayload({
      conversationId: "new",
      instruction: "分析原片",
      longFormAction: {
        kind: "analyze",
        sourceAssetId: 91,
      },
    })).toMatchObject({
      long_form_action: {
        kind: "analyze",
        source_asset_id: 91,
      },
    });

    expect(buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "做成短视频",
      longFormAction: {
        kind: "select",
        analysisAssetId: 92,
        candidateId: "cand_02",
        cleanupMode: "preserve_all",
      },
    })).toMatchObject({
      conversation_id: "asset-conversation-1",
      long_form_action: {
        kind: "select",
        analysis_asset_id: 92,
        candidate_id: "cand_02",
        cleanup_mode: "preserve_all",
      },
    });
  });

  it("loads one bounded library page by library kind", async () => {
    const backendRows = Array.from({ length: 49 }, (_, index) => asset({
      id: index + 1,
      library_kind: "video",
      asset_kind: index % 2 === 0 ? "video" : "video",
      content_type: index % 2 === 0 ? "uploaded_video" : "video_project",
      title: `视频条目 ${index + 1}`,
      updated_at: new Date(Date.UTC(2026, 6, 24, 2, 0, 49 - index)).toISOString(),
    }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(backendRows), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await assetWorkspaceAdapter.listLibrary(
      "token",
      "video",
      "",
      { offset: 0, limit: 48 },
    );
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1/assets");
    expect(requestUrl.searchParams.get("library_kind")).toBe("video");
    expect(requestUrl.searchParams.get("kind")).toBeNull();
    expect(requestUrl.searchParams.get("limit")).toBe("49");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(page.rows).toHaveLength(48);
    expect(page.nextOffset).toBe(48);
  });

  it("keeps exact search results when semantic search returns no matches", async () => {
    const exact = asset({ id: 81, title: "精确命中的素材" });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const pathname = new URL(String(input)).pathname;
      const payload = pathname.endsWith("/semantic-search")
        ? []
        : [{ asset: exact, snippet: exact.title, score: 1, matched_fields: ["title"] }];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = await assetWorkspaceAdapter.listLibrary("token", "assets", "精确命中");
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.rows.map((row) => row.assetId)).toEqual([81]);
  });

  it("keeps exact search results when semantic search is unavailable", async () => {
    const exact = asset({ id: 82, title: "Provider 降级素材" });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/semantic-search")) {
        return new Response(JSON.stringify({ detail: "unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([
        { asset: exact, snippet: exact.title, score: 1, matched_fields: ["title"] },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = await assetWorkspaceAdapter.listLibrary("token", "assets", "Provider 降级");
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.rows.map((row) => row.assetId)).toEqual([82]);
  });

  it("maps a video thumbnail separately from its playable preview", async () => {
    const video = asset({
      id: 72,
      library_kind: "video",
      asset_kind: "video",
      content_type: "uploaded_video",
      metadata: {
        preview_url: "https://cdn.example/video.mp4",
        thumbnail_url: "https://cdn.example/video-poster.jpg",
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([video]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await assetWorkspaceAdapter.listLibrary("token", "video");
    vi.unstubAllGlobals();

    expect(page.rows[0]).toMatchObject({
      previewUrl: "https://cdn.example/video.mp4",
      thumbnailUrl: "https://cdn.example/video-poster.jpg",
    });
  });

  it("serializes failed-scene material replacement as a bound action", () => {
    expect(buildConversationMessagePayload({
      conversationId: "asset-conversation-1",
      instruction: "重新寻找第 4 镜素材",
      selectedProductId: 440,
      videoSceneReplacement: {
        failedProjectAssetId: 440,
        sceneId: "seg-4",
      },
    })).toMatchObject({
      selected_product_id: 440,
      video_scene_replacement: {
        failed_project_asset_id: 440,
        scene_id: "seg-4",
      },
    });
  });

  it("maps a stored image reference through the media proxy for a list thumbnail", async () => {
    const image = asset({
      id: 73,
      library_kind: "image",
      asset_kind: "image",
      content_type: "storyboard_image",
      original_ref: "supabase://assets/user-73/scene.png",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([image]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await assetWorkspaceAdapter.listLibrary("token", "image");
    vi.unstubAllGlobals();

    expect(page.rows[0]?.previewUrl).toContain("/v1/video/media?ref=supabase%3A%2F%2Fassets%2Fuser-73%2Fscene.png");
  });

  it("preserves the backend content type needed by long-form library actions", async () => {
    const source = asset({
      id: 91,
      library_kind: "video",
      asset_kind: "video",
      content_type: "long_form_video_source",
      source_filename: "episode-12.mp4",
      source_content_type: "video/mp4",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([source]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await assetWorkspaceAdapter.listLibrary("token", "video");
    vi.unstubAllGlobals();

    expect(page.rows[0]).toMatchObject({
      assetId: 91,
      contentType: "视频",
      contentTypeCode: "long_form_video_source",
    });
  });

  it("reports actual multipart upload progress and returns the uploaded asset", async () => {
    class FakeUploadRequest {
      static instance: FakeUploadRequest | null = null;
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 201;
      statusText = "Created";
      responseText = JSON.stringify(asset({ id: 42 }));
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 } as ProgressEvent<EventTarget>);
        this.onload?.();
      });

      constructor() {
        FakeUploadRequest.instance = this;
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const progress = vi.fn();

    await expect(
      assetWorkspaceAdapter.uploadAsset("token", new File(["image"], "cover.png", { type: "image/png" }), "image", progress, "upload-key-42"),
    ).resolves.toMatchObject({ id: 42 });

    expect(progress).toHaveBeenCalledWith(25);
    expect(FakeUploadRequest.instance?.open).toHaveBeenCalledWith("POST", expect.stringContaining("/v1/assets/upload"));
    expect(FakeUploadRequest.instance?.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer token");
    expect(FakeUploadRequest.instance?.setRequestHeader).toHaveBeenCalledWith("Idempotency-Key", "upload-key-42");
    vi.unstubAllGlobals();
  });

  it("reports an indeterminate progress state when the browser cannot compute total bytes", async () => {
    class FakeUploadRequest {
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      status = 201;
      statusText = "Created";
      responseText = JSON.stringify(asset({ id: 43 }));
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn(() => {
        this.upload.onprogress?.({ lengthComputable: false, loaded: 25, total: 0 } as ProgressEvent<EventTarget>);
        this.onload?.();
      });
    }
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    const progress = vi.fn();

    await assetWorkspaceAdapter.uploadAsset("token", new File(["document"], "brief.pdf", { type: "application/pdf" }), "assets", progress);

    expect(progress).toHaveBeenCalledWith(null);
    vi.unstubAllGlobals();
  });

  it("retries one stalled multipart upload with the same idempotency key and form data", async () => {
    vi.useFakeTimers();
    class FakeUploadRequest {
      static instances: FakeUploadRequest[] = [];
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 201;
      statusText = "Created";
      responseText = JSON.stringify(asset({ id: 44 }));
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn((formData: FormData) => {
        if (FakeUploadRequest.instances.length === 1) {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 99, total: 100 } as ProgressEvent<EventTarget>);
          return;
        }
        expect(formData).toBe(FakeUploadRequest.instances[0]?.send.mock.calls[0]?.[0]);
        this.onload?.();
      });
      abort = vi.fn(() => this.onabort?.());

      constructor() {
        FakeUploadRequest.instances.push(this);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);

    try {
      const upload = assetWorkspaceAdapter.uploadAsset(
        "token",
        new File(["document"], "brief.pdf", { type: "application/pdf" }),
        "assets",
        vi.fn(),
        "stable-upload-key",
      );

      await vi.advanceTimersByTimeAsync(60_301);

      expect(FakeUploadRequest.instances).toHaveLength(2);
      expect(FakeUploadRequest.instances[0]?.abort).toHaveBeenCalledTimes(1);
      for (const request of FakeUploadRequest.instances) {
        expect(request.setRequestHeader).toHaveBeenCalledWith("Idempotency-Key", "stable-upload-key");
      }
      await expect(upload).resolves.toMatchObject({ id: 44 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("fails a stalled multipart upload instead of waiting forever when it has no idempotency key", async () => {
    vi.useFakeTimers();
    class FakeUploadRequest {
      static instances: FakeUploadRequest[] = [];
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      statusText = "";
      responseText = "";
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn(() => {
        this.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 } as ProgressEvent<EventTarget>);
      });
      abort = vi.fn(() => this.onabort?.());

      constructor() {
        FakeUploadRequest.instances.push(this);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);

    try {
      const upload = assetWorkspaceAdapter.uploadAsset(
        "token",
        new File(["document"], "brief.pdf", { type: "application/pdf" }),
        "assets",
        vi.fn(),
      );
      const rejection = expect(upload).rejects.toThrow("长时间没有进展");

      await vi.advanceTimersByTimeAsync(60_001);

      await rejection;
      expect(FakeUploadRequest.instances).toHaveLength(1);
      expect(FakeUploadRequest.instances[0]?.abort).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("extends the multipart stall boundary whenever upload progress continues", async () => {
    vi.useFakeTimers();
    class FakeUploadRequest {
      static instance: FakeUploadRequest | null = null;
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 201;
      statusText = "Created";
      responseText = JSON.stringify(asset({ id: 45 }));
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      abort = vi.fn(() => this.onabort?.());

      constructor() {
        FakeUploadRequest.instance = this;
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);

    try {
      const upload = assetWorkspaceAdapter.uploadAsset(
        "token",
        new File(["document"], "brief.pdf", { type: "application/pdf" }),
        "assets",
        vi.fn(),
        "progressing-upload-key",
      );

      await vi.advanceTimersByTimeAsync(40_000);
      FakeUploadRequest.instance?.upload.onprogress?.({
        lengthComputable: true,
        loaded: 50,
        total: 100,
      } as ProgressEvent<EventTarget>);
      await vi.advanceTimersByTimeAsync(40_000);

      expect(FakeUploadRequest.instance?.abort).not.toHaveBeenCalled();
      FakeUploadRequest.instance?.onload?.();
      await expect(upload).resolves.toMatchObject({ id: 45 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("stops after one idempotent retry when the replacement upload also stalls", async () => {
    vi.useFakeTimers();
    class FakeUploadRequest {
      static instances: FakeUploadRequest[] = [];
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      statusText = "";
      responseText = "";
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      abort = vi.fn(() => this.onabort?.());

      constructor() {
        FakeUploadRequest.instances.push(this);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);

    try {
      const upload = assetWorkspaceAdapter.uploadAsset(
        "token",
        new File(["document"], "brief.pdf", { type: "application/pdf" }),
        "assets",
        vi.fn(),
        "single-retry-upload-key",
      );
      const rejection = expect(upload).rejects.toThrow("长时间没有进展");

      await vi.advanceTimersByTimeAsync(60_301);
      expect(FakeUploadRequest.instances).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(60_001);

      await rejection;
      expect(FakeUploadRequest.instances).toHaveLength(2);
      expect(FakeUploadRequest.instances[0]?.abort).toHaveBeenCalledTimes(1);
      expect(FakeUploadRequest.instances[1]?.abort).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps a queued generation job in the send result", async () => {
    const now = "2026-07-17T06:00:00Z";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        conversation_id: "asset-conversation-queued",
        conversation: {
          id: "asset-conversation-queued",
          title: "产品介绍",
          status: "active",
          metadata: {},
          messages: [],
          products: [],
          created_at: now,
          updated_at: now,
        },
        user_message: "生成产品介绍",
        assistant_message: "内容生成任务已进入队列，完成后会自动更新当前对话。",
        intent: { operation: "create" },
        suggestions: [],
        product: null,
        generation_job: {
          id: "asset-generation-job-1",
          status: "queued",
          result_asset_id: null,
          error_message: null,
          created_at: now,
          updated_at: now,
        },
      }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assetWorkspaceAdapter.sendMessage({
      token: "token",
      conversationId: "new",
      instruction: "生成产品介绍",
      clientRequestId: "00000000-0000-0000-0000-000000000111",
    });

    expect(result.product).toBeNull();
    expect(result.generationJob?.id).toBe("asset-generation-job-1");
    expect(result.generationJob?.status).toBe("queued");
    expect(result.conversation.detailsLoaded).toBe(true);
    vi.unstubAllGlobals();
  });

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

    expect(result.current?.[0]).toMatchObject({ candidateId: "cur-1", selectable: false });
    expect(result.recommended[0]).toMatchObject({ candidateId: "cand-1", assetId: 12, reason: "匹配施工过程" });
    expect(result.library[0]).toMatchObject({ candidateId: "cand-2" });
    vi.unstubAllGlobals();
  });

  it("surfaces a candidate endpoint 404 instead of falling back to deleted routes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Segment material candidates v2 is disabled." }), { status: 404, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      assetWorkspaceAdapter.loadSegmentMaterialCandidates("token", 9100, "segment-1", "local"),
    ).rejects.toThrow("Segment material candidates v2 is disabled.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      new Response(JSON.stringify({ id: "job-1", asset_id: 9100, status: "queued", workflow_stage: "video_project_queued", error_message: null, project: null }), { status: 202, headers: { "Content-Type": "application/json" } }),
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-recompose", asset_id: 9100, status: "queued", workflow_stage: "video_project_queued", error_message: null, project: null }), { status: 202, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", { candidateId: "cand-12" })).resolves.toEqual({
      kind: "confirm_overwrite",
      message: "会覆盖手工剪辑",
    });
    await expect(assetWorkspaceAdapter.replaceSegmentMaterial("token", 9100, "segment-1", { candidateId: "cand-12" }, true)).resolves.toMatchObject({
      kind: "started",
      job: { id: "job-recompose" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      operation: "replace_material",
      candidate_id: "cand-12",
      confirm_overwrite: true,
    });
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

  it("reloads a legacy row that has no explicit detail-loaded flag", () => {
    const summary: AssetConversationSummaryResponse = {
      id: "asset-conversation-legacy",
      title: "旧版缓存对话",
      status: "active",
      metadata: {},
      created_at: "2026-07-12T08:00:00Z",
      updated_at: "2026-07-12T09:00:00Z",
    };
    const legacyRow = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: summary.id,
      title: "旧标题",
    };
    delete legacyRow.detailsLoaded;

    const [merged] = assetWorkspaceAdapter.mergeConversationSummaries(
      [summary],
      [legacyRow],
    );

    expect(merged.detailsLoaded).toBe(false);
    expect(merged.messages).toEqual([]);
  });

  it("keeps bundled demo data out of the production adapter", () => {
    const source = readFileSync(resolve(process.cwd(), "app/assets/lib/asset-workspace-adapter.ts"), "utf8");

    expect(source).not.toContain("asset-workspace-mock-data");
    expect(source).not.toContain("mockAssetWorkspaceData");
    expect(source).not.toContain("Local mock revision");
    expect(source).not.toContain("Local mock restore");
  });

  it("proactively disables video confirmation cards during write maintenance", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/assets/components/conversation-studio.tsx"),
      "utf8",
    );

    expect(source).toContain("VIDEO_WRITES_PAUSED");
    expect(source).toContain("video_parameter_confirmation");
    expect(source).toContain("video_project_confirmation");
    expect(source).toContain("VIDEO_WRITES_PAUSED_MESSAGE");
  });

  it("shares asset title normalization instead of maintaining two copies", () => {
    const shared = readFileSync(resolve(process.cwd(), "app/assets/lib/asset-workspace-shared.ts"), "utf8");
    const adapter = readFileSync(resolve(process.cwd(), "app/assets/lib/asset-workspace-adapter.ts"), "utf8");
    const mappers = readFileSync(resolve(process.cwd(), "lib/asset-mappers.ts"), "utf8");

    expect(shared).toContain("export function normalizeAssetTitle");
    expect(adapter).not.toContain("function normalizeAssetTitle");
    expect(mappers).not.toContain("function normalizeProductTitle");
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
