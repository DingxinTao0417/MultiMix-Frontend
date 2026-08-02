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
});

describe("hydrateAssetFiles", () => {
  it("abandons one no-response resource and still hydrates the remaining media", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
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
    await vi.advanceTimersByTimeAsync(90_000);
    const assets = await hydrated;

    expect(assets[0]).toMatchObject({ ...stalledMedia, url: "https://example.test/stalled.mp4" });
    expect(assets[1].file).toBeInstanceOf(File);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
