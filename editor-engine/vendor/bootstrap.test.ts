import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@editor/core", () => ({
  EditorCore: { getInstance: vi.fn(), reset: vi.fn() },
}));
vi.mock("./buildProject", () => ({ buildProject: vi.fn() }));
vi.mock("./api", () => ({ mediaUrl: (path: string) => path }));

import { hydrateAssetFiles } from "./bootstrap";
import type { BackendProject } from "./buildProject";

const stalledMedia = {
  id: "stalled-video",
  type: "video" as const,
  name: "stalled.mp4",
  url: "bgm://stalled-video",
};
const readyMedia = {
  id: "ready-video",
  type: "video" as const,
  name: "ready.mp4",
  url: "https://example.test/ready.mp4",
};

function projectWithMedia(): BackendProject {
  return {
    metadata: { title: "hydration", duration: 1 },
    settings: { fps: 30, width: 1920, height: 1080 },
    tracks: [],
    media: [
      {
        id: stalledMedia.id,
        type: "video",
        name: stalledMedia.name,
        file_path: stalledMedia.url,
        playback_url: "https://example.test/stalled.mp4",
      },
      { id: readyMedia.id, type: "video", name: readyMedia.name, file_path: readyMedia.url },
    ],
  } as BackendProject;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hydrateAssetFiles", () => {
  it("abandons one no-response resource and still hydrates the remaining media", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("stalled")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return Promise.resolve(new Response(new Blob(["ok"], { type: "video/mp4" })));
    });
    vi.stubGlobal("fetch", fetchMock);
    const progress = vi.fn();

    const hydrated = hydrateAssetFiles([stalledMedia, readyMedia], projectWithMedia(), progress);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const assets = await hydrated;

    expect(assets[0]).toMatchObject({ ...stalledMedia, url: "https://example.test/stalled.mp4" });
    expect(assets[1].file).toBeInstanceOf(File);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      "media hydration failed",
      expect.objectContaining({
        assetId: stalledMedia.id,
        reason: "timeout",
        durationMs: expect.any(Number),
        url: "https://example.test/stalled.mp4",
      }),
    );
  });

  it("records response details and duration for every successfully downloaded asset", async () => {
    vi.stubGlobal("window", globalThis);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Blob(["ok"], { type: "video/mp4" }), { status: 200 })),
    );

    const assets = await hydrateAssetFiles([readyMedia], projectWithMedia());

    expect(assets[0].file).toBeInstanceOf(File);
    expect(info).toHaveBeenCalledWith(
      "media hydration succeeded",
      expect.objectContaining({
        assetId: readyMedia.id,
        assetType: "video",
        bytes: 2,
        contentType: "video/mp4",
        durationMs: expect.any(Number),
        status: 200,
        url: readyMedia.url,
      }),
    );
  });

  it("separates unavailable media from an unexpected response type in diagnostics", async () => {
    vi.stubGlobal("window", globalThis);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("stalled")) {
        return Promise.resolve(new Response("missing", { status: 404, headers: { "content-type": "text/plain" } }));
      }
      return Promise.resolve(new Response("not a video", { status: 200, headers: { "content-type": "text/plain" } }));
    }));

    await hydrateAssetFiles([stalledMedia, readyMedia], projectWithMedia());

    expect(warning).toHaveBeenCalledWith(
      "media hydration failed",
      expect.objectContaining({ assetId: stalledMedia.id, reason: "http", status: 404 }),
    );
    expect(warning).toHaveBeenCalledWith(
      "media hydration failed",
      expect.objectContaining({ assetId: readyMedia.id, contentType: "text/plain", reason: "mime", status: 200 }),
    );
  });
});
