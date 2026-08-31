// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  prepareLongFormComposerSource,
  resolveLongFormAnalyzeAction,
  supportedLongFormUrlFromText,
} from "../lib/long-form-composer-source";
import {
  importLongFormSourceUrl,
  uploadLongFormSource,
  waitForLongFormSourceReady,
} from "../lib/long-form-client";

vi.mock("../lib/long-form-client", () => ({
  uploadLongFormSource: vi.fn(),
  importLongFormSourceUrl: vi.fn(),
  waitForLongFormSourceReady: vi.fn(),
}));

const uploadMock = vi.mocked(uploadLongFormSource);
const importUrlMock = vi.mocked(importLongFormSourceUrl);
const waitReadyMock = vi.mocked(waitForLongFormSourceReady);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("long-form composer source", () => {
  it.each([
    "https://youtu.be/abc123",
    "https://www.youtube.com/watch?v=abc123",
    "https://www.bilibili.com/video/BV1xx411c7mD",
    "https://cdn.example.com/podcast.mp4",
  ])("recognizes a supported standalone video URL: %s", (value) => {
    expect(supportedLongFormUrlFromText(value)).toBe(value);
  });

  it.each([
    "看看 https://www.youtube.com/watch?v=abc123",
    "https://example.com/article",
    "ftp://cdn.example.com/podcast.mp4",
    "not-a-url",
  ])("keeps ordinary composer text untouched: %s", (value) => {
    expect(supportedLongFormUrlFromText(value)).toBeNull();
  });

  it("uploads a local video without starting analysis", async () => {
    const file = new File(["video"], "episode.mp4", { type: "video/mp4" });
    const onProgress = vi.fn();
    uploadMock.mockResolvedValue({ id: 91, title: "访谈第 12 期" });

    await expect(prepareLongFormComposerSource({
      token: "token",
      input: { kind: "file", file },
      signal: new AbortController().signal,
      onProgress,
    })).resolves.toEqual({ id: 91, title: "访谈第 12 期" });

    expect(uploadMock).toHaveBeenCalledWith("token", file, onProgress);
    expect(importUrlMock).not.toHaveBeenCalled();
  });

  it("waits for a URL import to become durable without starting analysis", async () => {
    importUrlMock.mockResolvedValue({
      asset_id: 93,
      job_id: "long-form-ingest-1",
      status: "queued",
      source_kind: "youtube",
    });
    waitReadyMock.mockResolvedValue({
      id: "long-form-ingest-1",
      asset_id: 93,
      status: "completed",
      error_message: null,
    });
    const signal = new AbortController().signal;

    await expect(prepareLongFormComposerSource({
      token: "token",
      input: { kind: "url", url: "https://youtu.be/abc123" },
      signal,
      onProgress: vi.fn(),
    })).resolves.toEqual({ id: 93, title: "网络视频" });

    expect(waitReadyMock).toHaveBeenCalledWith("token", 93, signal);
  });
});

describe("long-form analysis submit contract", () => {
  const readyVideo = { assetId: 91, fileKind: "video" as const, status: "ready" as const };

  it("requires exactly one ready video and a submitted requirement", () => {
    expect(resolveLongFormAnalyzeAction([], "找出值得发布的片段")).toBeUndefined();
    expect(resolveLongFormAnalyzeAction([readyVideo], "")).toBeUndefined();
    expect(resolveLongFormAnalyzeAction([
      readyVideo,
      { assetId: 92, fileKind: "video", status: "ready" },
    ], "找出值得发布的片段")).toBeUndefined();
    expect(resolveLongFormAnalyzeAction([readyVideo], "找出值得发布的片段")).toEqual({
      kind: "analyze",
      sourceAssetId: 91,
    });
  });
});
