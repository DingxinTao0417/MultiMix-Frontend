import { describe, expect, it } from "vitest";

import {
  readConversationSummaryCache,
  writeConversationSummaryCache,
  type ConversationSummaryStorage,
} from "../lib/conversation-summary-cache";

function memoryStorage(): ConversationSummaryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const summary = {
  id: "asset-conversation-480",
  title: "MultiMix 产品介绍短视频",
  status: "active",
  project_state: { code: "ready" as const },
  metadata: { video_workflow_stage: "video_project_ready" },
  created_at: "2026-07-12T08:00:00Z",
  updated_at: "2026-07-12T09:00:00Z",
};

describe("conversation summary cache", () => {
  it("isolates cached summaries by account and keeps only summary fields", () => {
    const storage = memoryStorage();
    writeConversationSummaryCache(storage, "first@example.com", [summary], 1_000);

    expect(readConversationSummaryCache(storage, "first@example.com", 2_000)).toEqual([summary]);
    expect(readConversationSummaryCache(storage, "second@example.com", 2_000)).toEqual([]);
    expect(JSON.stringify(readConversationSummaryCache(storage, "first@example.com", 2_000))).not.toContain("messages");
    expect(JSON.stringify(readConversationSummaryCache(storage, "first@example.com", 2_000))).not.toContain("products");
  });

  it("shows recent stale data while background revalidation runs", () => {
    const storage = memoryStorage();
    const oneDay = 24 * 60 * 60 * 1_000;
    writeConversationSummaryCache(storage, "first@example.com", [summary], 1_000);

    expect(readConversationSummaryCache(storage, "first@example.com", 1_000 + oneDay)).toEqual([summary]);
  });

  it("ignores and removes malformed cache entries", () => {
    const storage = memoryStorage();
    storage.setItem("multimix:conversation-summaries:v2:first%40example.com", "not-json");

    expect(readConversationSummaryCache(storage, "first@example.com", 2_000)).toEqual([]);
    expect(storage.getItem("multimix:conversation-summaries:v2:first%40example.com")).toBeNull();
  });

  it("drops cached rows that predate the server-owned project state", () => {
    const storage = memoryStorage();
    storage.setItem("multimix:conversation-summaries:v2:first%40example.com", JSON.stringify({
      savedAt: 1_000,
      summaries: [{
        id: "asset-conversation-legacy",
        title: "旧缓存项目",
        status: "active",
        metadata: {},
        created_at: "2026-07-12T08:00:00Z",
        updated_at: "2026-07-12T09:00:00Z",
      }],
    }));

    expect(readConversationSummaryCache(storage, "first@example.com", 2_000)).toEqual([]);
    expect(storage.getItem("multimix:conversation-summaries:v2:first%40example.com")).toBeNull();
  });
});
