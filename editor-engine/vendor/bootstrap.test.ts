import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@editor/core", () => ({
  EditorCore: { getInstance: vi.fn(), reset: vi.fn() },
}));
vi.mock("./buildProject", () => ({ buildProject: vi.fn() }));
vi.mock("./api", () => ({ mediaUrl: (path: string) => path }));

import * as bootstrap from "./bootstrap";
import type { BackendProject } from "./buildProject";

const { hydrateAssetFiles } = bootstrap;

type ExportHydrator = (
  assets: Array<typeof stalledMedia & { file: File }>,
  project: BackendProject,
  options?: { chunkBytes?: number; requestTimeoutMs?: number; totalTimeoutMs?: number },
) => Promise<Array<typeof stalledMedia & { file: File }>>;

function exportHydrator(): ExportHydrator {
  const candidate = (bootstrap as unknown as { hydrateAssetFilesForExport?: ExportHydrator })
    .hydrateAssetFilesForExport;
  expect(candidate, "export hydration must be a separate strict contract from preview hydration").toBeTypeOf("function");
  return candidate!;
}

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
    await vi.advanceTimersByTimeAsync(59_999);
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

  it("hydrates a slow but valid WebM before allowing the export renderer to use it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
      window.setTimeout(
        () => resolve(new Response(new Blob(["slow-webm"], { type: "video/webm" }), { status: 200 })),
        16_000,
      );
    })));

    const slowWebm = {
      id: "slow-webm",
      type: "video" as const,
      name: "slow.webm",
      url: "https://example.test/slow.webm",
    };
    const project = {
      ...projectWithMedia(),
      media: [{ id: slowWebm.id, type: "video", name: slowWebm.name, file_path: slowWebm.url }],
    } as BackendProject;

    const hydrated = hydrateAssetFiles([slowWebm], project);
    await vi.advanceTimersByTimeAsync(16_000);
    const assets = await hydrated;

    expect(aborted).toBe(false);
    expect(assets[0].file).toBeInstanceOf(File);
    expect(assets[0].file?.type).toBe("video/webm");
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

describe("hydrateAssetFilesForExport", () => {
  it("assembles a zero-byte video from contiguous byte-range responses", async () => {
    vi.stubGlobal("window", globalThis);
    const source = new TextEncoder().encode("abcdefghij");
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range") || "";
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      expect(match).not.toBeNull();
      const start = Number(match![1]);
      const requestedEnd = Number(match![2]);
      const end = Math.min(requestedEnd, source.byteLength - 1);
      const body = source.slice(start, end + 1);
      return Promise.resolve(new Response(body, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(body.byteLength),
          "content-range": `bytes ${start}-${end}/${source.byteLength}`,
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const asset = { ...stalledMedia, file: new File([], stalledMedia.name) };

    const hydrated = await exportHydrator()([asset], projectWithMedia(), { chunkBytes: 4 });

    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("range"))).toEqual([
      "bytes=0-3",
      "bytes=4-7",
      "bytes=8-11",
    ]);
    expect(hydrated[0].file.size).toBe(source.byteLength);
    expect(new Uint8Array(await hydrated[0].file.arrayBuffer())).toEqual(source);
    expect(hydrated[0].file.type).toBe("video/mp4");
  });

  it("rejects a partial response whose Content-Range is not the requested contiguous range", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bc", {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-length": "2",
        "content-range": "bytes 1-2/4",
      },
    })));
    const asset = { ...stalledMedia, file: new File([], stalledMedia.name) };

    await expect(exportHydrator()([asset], projectWithMedia(), { chunkBytes: 4 })).rejects.toThrow(
      /Content-Range|range/i,
    );
  });

  it("accepts a complete HTTP 200 response as a compatibility fallback", async () => {
    vi.stubGlobal("window", globalThis);
    const source = new TextEncoder().encode("complete-video");
    const fetchMock = vi.fn().mockResolvedValue(new Response(source, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(source.byteLength),
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const asset = { ...stalledMedia, file: new File([], stalledMedia.name) };

    const hydrated = await exportHydrator()([asset], projectWithMedia(), { chunkBytes: 4 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await hydrated[0].file.arrayBuffer())).toEqual(source);
  });

  it("aborts a stalled export range with an explicit timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    })));
    const asset = { ...stalledMedia, file: new File([], stalledMedia.name) };

    const hydration = exportHydrator()([asset], projectWithMedia(), {
      chunkBytes: 4,
      requestTimeoutMs: 25,
      totalTimeoutMs: 100,
    });
    const capturedError = hydration.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(25);

    expect(await capturedError).toBeInstanceOf(Error);
    expect((await capturedError as Error).message).toMatch(/timed out|超时/i);
    expect(aborted).toBe(true);
  });
});
