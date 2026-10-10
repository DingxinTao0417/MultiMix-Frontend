import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@editor/core", () => ({
  EditorCore: { getInstance: vi.fn(), reset: vi.fn() },
}));
vi.mock("./buildProject", () => ({ buildProject: vi.fn() }));
vi.mock("./api", () => ({
  API_BASE: "https://api.example.test",
  mediaUrl: (path: string) => path,
}));

import * as bootstrap from "./bootstrap";
import type { BackendProject } from "./buildProject";
import { buildProject } from "./buildProject";
import { EditorCore } from "@editor/core";

const { hydrateAssetFiles } = bootstrap;

function mediaEvents(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls.flatMap(([message]) => typeof message === "string" && message.startsWith("[MediaLoad] ")
    ? [JSON.parse(message.slice("[MediaLoad] ".length))] : []);
}

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
  it.each(["await_response", "read_body"] as const)("records a readable network failure at %s without sensitive values", async (failedAt) => {
    vi.stubGlobal("window", globalThis);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "private-name token=private-token body-private-error";
    const response = new Response("valid", { status: 206 });
    vi.spyOn(response, "blob").mockRejectedValue(new TypeError(secret));
    vi.stubGlobal("fetch", vi.fn(() => failedAt === "await_response"
      ? Promise.reject(new TypeError(secret)) : Promise.resolve(response)));
    await expect(hydrateAssetFiles([readyMedia], projectWithMedia())).rejects.toThrow(secret);
    const [event] = mediaEvents(warning);
    expect(event).toMatchObject({ stage: "preview", outcome: "failed", mediaIndex: 0, mediaType: "video", reason: "network", failedAt, rangeStart: 0, requestTimeoutMs: 60_000 });
    if (failedAt === "read_body") expect(event.status).toBe(206);
    else expect(event).not.toHaveProperty("status");
    expect(JSON.stringify(event)).not.toContain(secret);
    expect(JSON.stringify(event)).not.toContain(readyMedia.url);
    expect(JSON.stringify(event)).not.toContain(readyMedia.name);
    expect(Object.keys(event)).toEqual(expect.arrayContaining(["timestamp", "durationMs"]));
  });

  it("distinguishes a response-body timeout after successful headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      const response = new Response("valid", { status: 206 });
      vi.spyOn(response, "blob").mockImplementation(() => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
      return Promise.resolve(response);
    }));
    const pending = hydrateAssetFiles([readyMedia], projectWithMedia());
    const rejected = expect(pending).rejects.toThrow("timed out after 60000ms");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(mediaEvents(warning)).toEqual([expect.objectContaining({ reason: "timeout", failedAt: "read_body", status: 206, requestTimeoutMs: 60_000 })]);
  });

  it("keeps success and original failure semantics when console logging throws", async () => {
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("writer unavailable"); });
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("writer unavailable"); });
    const fetchMock = vi.fn().mockResolvedValue(new Response("valid", { headers: { "content-type": "video/mp4" } }));
    vi.stubGlobal("fetch", fetchMock);
    const [asset] = await hydrateAssetFiles([readyMedia], projectWithMedia());
    expect(asset.file.size).toBe(5);
    fetchMock.mockRejectedValue(new TypeError("original network failure"));
    await expect(hydrateAssetFiles([readyMedia], projectWithMedia())).rejects.toThrow("original network failure");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when valid individual ranges exceed the total preparation deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const original = new Uint8Array(8 * 1024 * 1024);
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const range = new Headers(init?.headers).get("range")!.match(/^bytes=(\d+)-(\d+)$/)!;
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), original.length - 1);
      const timer = window.setTimeout(() => resolve(new Response(original.slice(start, end + 1), {
        status: 206,
        headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${original.length}` },
      })), 40_000);
      init?.signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = hydrateAssetFiles([readyMedia], projectWithMedia());
    const rejected = expect(pending).rejects.toThrow(/deadline|timed out/);
    await vi.advanceTimersByTimeAsync(300_001);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it.each([
    ["HTTP failure", () => new Response("missing", { status: 404 }), /HTTP 404/],
    ["wrong MIME", () => new Response("wrong", { headers: { "content-type": "text/plain" } }), /Unexpected media type/],
    ["invalid range", () => new Response("wrong", { status: 206, headers: { "content-type": "video/mp4" } }), /Invalid Content-Range/],
  ] as const)("rejects preparation on %s instead of returning media without a File", async (_name, response, error) => {
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal("fetch", fetchMock);
    await expect(hydrateAssetFiles([readyMedia], projectWithMedia())).rejects.toThrow(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["initial", "project update", "music update"] as const)("keeps editor state unpublished after a failed %s preparation", async (operation) => {
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("transport unavailable")));
    const editor = {
      project: { setActiveProject: vi.fn() },
      scenes: { initializeScenes: vi.fn() },
      media: { clearAllAssets: vi.fn(), setAssets: vi.fn(), getAssets: vi.fn(() => [readyMedia]) },
      timeline: { updateTracks: vi.fn(), getTracks: vi.fn(() => []) },
    };
    vi.mocked(EditorCore.getInstance).mockReturnValue(editor as unknown as ReturnType<typeof EditorCore.getInstance>);
    const asset = operation === "music update"
      ? { ...readyMedia, id: "media-bgm-kept", type: "audio" as const }
      : readyMedia;
    const project = { ...projectWithMedia(), media: [{ id: asset.id, name: asset.name, type: asset.type, file_path: asset.url }] };
    vi.mocked(buildProject).mockReturnValue({ project: { scenes: [{ tracks: [] }] }, assets: [asset] } as unknown as ReturnType<typeof buildProject>);
    const pending = operation === "initial" ? bootstrap.initEditorWithProject(project)
      : operation === "project update" ? bootstrap.updateEditorProject(project)
        : bootstrap.updateEditorBgm(project, () => true);
    await expect(pending).rejects.toThrow("transport unavailable");
    expect(editor.project.setActiveProject).not.toHaveBeenCalled();
    expect(editor.scenes.initializeScenes).not.toHaveBeenCalled();
    expect(editor.media.clearAllAssets).not.toHaveBeenCalled();
    expect(editor.media.setAssets).not.toHaveBeenCalled();
    expect(editor.timeline.updateTracks).not.toHaveBeenCalled();
  });

  it.each(["initial", "project update"] as const)("publishes a successful %s only after media preparation completes", async (operation) => {
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const calls: string[] = [];
    const editor = {
      project: { setActiveProject: vi.fn(() => calls.push("project")) },
      scenes: { initializeScenes: vi.fn(() => calls.push("scenes")) },
      media: { clearAllAssets: vi.fn(() => calls.push("clear")), setAssets: vi.fn(() => calls.push("media")) },
    };
    vi.mocked(EditorCore.getInstance).mockReturnValue(editor as unknown as ReturnType<typeof EditorCore.getInstance>);
    vi.mocked(buildProject).mockReturnValue({ project: { scenes: [{ tracks: [] }] }, assets: [readyMedia] } as unknown as ReturnType<typeof buildProject>);
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = operation === "initial" ? bootstrap.initEditorWithProject(projectWithMedia())
      : bootstrap.updateEditorProject(projectWithMedia());
    expect(calls).toEqual([]);
    finish(new Response("valid-file", { headers: { "content-type": "video/mp4" } }));
    await pending;
    expect(calls).toEqual(["clear", "project", "scenes", "media"]);
    expect(editor.media.setAssets).toHaveBeenCalledWith({ assets: [expect.objectContaining({ file: expect.any(File) })] });
  });

  it("loads signed original video through the configured HTTPS API origin", async () => {
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["original"], { type: "video/mp4" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const project = projectWithMedia();
    project.media[0].playback_url =
      "http://internal-api:8000/v1/video/projects/42/media/7?token=signed%2Bvalue";
    const [asset] = await hydrateAssetFiles([stalledMedia], project);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/video/projects/42/media/7?token=signed%2Bvalue",
    );
    expect(asset.file).toBeInstanceOf(File);
  });

  it("prepares a complete large video in bounded ranges when the total download exceeds one minute", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const chunkBytes = 1024 * 1024;
    const original = new Uint8Array(chunkBytes * 2 + 4).fill(7);
    original[0] = 11;
    original[original.length - 1] = 13;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const range = new Headers(init?.headers).get("range");
      const match = range?.match(/^bytes=(\d+)-(\d+)$/);
      const timer = window.setTimeout(() => {
        if (!match) {
          resolve(new Response(original, { headers: { "content-type": "video/mp4" } }));
          return;
        }
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), original.length - 1);
        resolve(new Response(original.slice(start, end + 1), {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": `bytes ${start}-${end}/${original.length}`,
            "content-length": String(end - start + 1),
          },
        }));
      }, match ? 27_000 : 81_000);
      init?.signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = hydrateAssetFiles([readyMedia], projectWithMedia());
    await vi.advanceTimersByTimeAsync(81_000);
    const [asset] = await pending;

    expect(asset.file).toBeInstanceOf(File);
    expect(asset.file.size).toBe(original.length);
    expect(Buffer.from(await asset.file.arrayBuffer()).equals(Buffer.from(original))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a stalled resource instead of publishing a partial preview", async () => {
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
    const rejected = expect(hydrated).rejects.toThrow("Media range request timed out after 60000ms");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mediaEvents(warning)).toEqual([
      expect.objectContaining({
        mediaIndex: 0,
        reason: "timeout",
        durationMs: expect.any(Number),
        failedAt: "await_response",
      }),
    ]);
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
    expect(mediaEvents(info)).toEqual([
      expect.objectContaining({
        stage: "preview", outcome: "prepared", mediaIndex: 0, mediaType: "video",
        bytes: 2,
        durationMs: expect.any(Number),
        status: 200,
      }),
    ]);
    expect(Object.keys(mediaEvents(info)[0]).sort()).toEqual(["bytes", "durationMs", "mediaIndex", "mediaType", "outcome", "stage", "status", "timestamp"]);
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

    await expect(hydrateAssetFiles([stalledMedia, readyMedia], projectWithMedia())).rejects.toThrow("HTTP 404");

    expect(mediaEvents(warning)).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaIndex: 0, reason: "http", status: 404, failedAt: "validate" }),
      expect.objectContaining({ mediaIndex: 1, reason: "mime", status: 200, failedAt: "validate" }),
    ]));
  });
});

describe("hydrateAssetFilesForExport", () => {
  it.each(["prepared", "failed"] as const)("reports %s export preparation using the same private-data-free contract", async (outcome) => {
    vi.stubGlobal("window", globalThis);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(() => outcome === "failed"
      ? Promise.reject(new TypeError("private-error"))
      : Promise.resolve(new Response("valid", { headers: { "content-type": "video/mp4" } }))));
    const pending = bootstrap.hydrateAssetFilesForExport([{ ...readyMedia, file: new File([], readyMedia.name) }], projectWithMedia());
    if (outcome === "failed") await expect(pending).rejects.toThrow("private-error");
    else expect((await pending)[0].file.size).toBe(5);
    const [event] = [...mediaEvents(info), ...mediaEvents(warning)];
    expect(event).toMatchObject({ stage: "export", outcome, mediaIndex: 0, mediaType: "video" });
    if (outcome === "failed") expect(event).toMatchObject({ reason: "network", failedAt: "await_response" });
    expect(JSON.stringify(event)).not.toMatch(/private-error|example\.test|ready\.mp4|url|headers|stack|message/);
  });

  it("records actual failure elapsed time instead of the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(() => new Promise((_resolve, reject) => {
      window.setTimeout(() => reject(new TypeError("network unavailable")), 12);
    })));
    const pending = bootstrap.hydrateAssetFilesForExport([{ ...readyMedia, file: new File([], readyMedia.name) }], projectWithMedia());
    const rejected = expect(pending).rejects.toThrow("network unavailable");
    await vi.advanceTimersByTimeAsync(12);
    await rejected;
    expect(mediaEvents(warning)[0]).toMatchObject({ durationMs: 12, requestTimeoutMs: 60_000, reason: "network" });
  });

  it("retains the canonical original playback address after serialization for export", async () => {
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn(() => Promise.resolve(
      new Response(new Blob(["original"], { type: "video/mp4" })),
    ));
    vi.stubGlobal("fetch", fetchMock);
    const project = projectWithMedia();
    project.media[0].playback_url =
      "http://internal-api:8000/v1/video/projects/42/media/7?token=signed%2Bvalue";
    await hydrateAssetFiles([stalledMedia], project);
    const serialized = { ...project, media: project.media.map(({ playback_url: _url, ...m }) => m) };
    fetchMock.mockClear();
    await bootstrap.hydrateAssetFilesForExport([{ ...stalledMedia, file: new File([], "source.mp4") }], serialized);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.test/v1/video/projects/42/media/7?token=signed%2Bvalue",
    );
  });

  it("reuses the authorized BGM playback URL after project serialization strips the token", async () => {
    vi.stubGlobal("window", globalThis);
    const signedPlaybackUrl = "https://api.example.test/v1/video/bgm/media/jungle-shop?token=signed";
    const bgmAsset = {
      id: "media-bgm-jungle-shop",
      type: "audio" as const,
      name: "Jungle Shop",
      url: "bgm://jungle-shop",
      file: new File([], "Jungle Shop"),
    };
    const loadedProject = {
      metadata: { title: "bgm export retry", duration: 15 },
      settings: { fps: 24, width: 544, height: 960 },
      tracks: [],
      media: [{
        id: bgmAsset.id,
        type: "audio" as const,
        name: bgmAsset.name,
        file_path: bgmAsset.url,
        playback_url: signedPlaybackUrl.replace("https://", "http://"),
      }],
    } as BackendProject;
    const serializedProject = {
      ...loadedProject,
      media: loadedProject.media.map(({ playback_url: _playbackUrl, ...media }) => media),
    } as BackendProject;
    let exporting = false;
    const source = new TextEncoder().encode("authorized-bgm");
    const fetchMock = vi.fn((url: string) => {
      if (!exporting) {
        return Promise.resolve(new Response('{"detail":"preview unavailable"}', {
          status: 503,
          headers: { "content-type": "application/json" },
        }));
      }
      expect(url).toBe(signedPlaybackUrl);
      return Promise.resolve(new Response(source, {
        status: 200,
        headers: {
          "content-type": "audio/mp4",
          "content-length": String(source.byteLength),
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(hydrateAssetFiles([bgmAsset], loadedProject)).rejects.toThrow("HTTP 503");
    const previewAssets = [bgmAsset];
    exporting = true;

    const hydrated = await exportHydrator()(previewAssets, serializedProject, { chunkBytes: 64 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hydrated[0].file.type).toBe("audio/mp4");
    expect(new Uint8Array(await hydrated[0].file.arrayBuffer())).toEqual(source);
  });

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
