import { afterEach, describe, expect, it, vi } from "vitest";
import { relayVideoMedia } from "../video-media-relay";
import { GET } from "../../app/api/video-media/[...path]/route";

const base = "https://multimix-backend-production.up.railway.app";
const path = ["projects", "42", "media", "7"];
const request = (query = "token=signed%2Bvalue", range = "bytes=0-3", signal?: AbortSignal) =>
  new Request(`https://multimix-frontend.vercel.app/api/video-media/projects/42/media/7?${query}`, {
    headers: { Range: range, Cookie: "must-not-forward", Authorization: "must-not-forward" }, signal,
  });
const media = (body: BodyInit = new Uint8Array([1, 2, 3, 4]), headers: Record<string, string> = {}) =>
  new Response(body, { status: 206, headers: {
    "content-type": "video/mp4", "content-range": "bytes 0-3/100", "content-length": "4", ...headers,
  } });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("same-origin signed media range delivery", () => {
  it("serves the public Next route using its configured target and async path parameters", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", base);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media()));
    const response = await GET(request(), { params: Promise.resolve({ path }) });
    expect(response.status).toBe(206);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });
  it("forwards only the existing token and Range to the fixed API and returns identical bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(media()); vi.stubGlobal("fetch", fetchMock);
    const response = await relayVideoMedia(request(), path, base);
    expect(response.status).toBe(206);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${base}/v1/video/projects/42/media/7?token=signed%2Bvalue`);
    expect(new Headers(init.headers).get("Range")).toBe("bytes=0-3");
    expect(new Headers(init.headers).get("Cookie")).toBeNull();
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-range")).toBe("bytes 0-3/100");
  });

  it.each([
    [[], "token=t", "bytes=0-3"],
    [["projects", "42", "media", "../admin"], "token=t", "bytes=0-3"],
    [["projects", "42", "media", "7", "extra"], "token=t", "bytes=0-3"],
    [path, "token=t&url=https://attacker.test", "bytes=0-3"],
    [path, "token=t&token=other", "bytes=0-3"],
    [path, "", "bytes=0-3"],
    [path, "token=t", ""],
    [path, "token=t", "bytes=0-"],
    [path, "token=t", "bytes=0-3,5-7"],
    [path, "token=t", "bytes=0-1048576"],
    [path, "token=t", "bytes=10-1"],
  ])("rejects invalid paths, authorization/query contracts or unbounded ranges before fetch", async (segments, query, range) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await relayVideoMedia(request(query, range), segments, base);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unexpected API base rather than reaching another host", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await relayVideoMedia(request(), path, "https://attacker.test")).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows explicitly configured loopback APIs only outside Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://127.0.0.1:8199");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media()));
    expect((await GET(request(), { params: Promise.resolve({ path }) })).status).toBe(206);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("http://127.0.0.1:8199/v1/video/projects/42/media/7");
    vi.stubEnv("VERCEL", "1");
    vi.mocked(fetch).mockClear();
    expect((await relayVideoMedia(request(), path, "http://127.0.0.1:8199")).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports the same restricted contract for music", async () => {
    const fetchMock = vi.fn().mockResolvedValue(media(undefined, { "content-type": "audio/mpeg" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await relayVideoMedia(request(), ["bgm", "media", "jungle-shop"], base)).status).toBe(206);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/video/bgm/media/jungle-shop?token=");
  });

  it.each([401, 403, 404, 416])("preserves upstream denial %s without leaking its body", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private upstream details", { status })));
    const response = await relayVideoMedia(request(), path, base);
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private upstream details");
  });

  const invalidHeaders: Record<string, string>[] = [
    { "content-range": "bytes 1-4/100" },
    { "content-range": "bytes 0-3/2" },
    { "content-length": "5" },
    { "content-type": "text/html" },
  ];
  it.each(invalidHeaders)("rejects a response outside the declared media range/length/type contract", async headers => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media(undefined, headers)));
    expect((await relayVideoMedia(request(), path, base)).status).toBe(502);
  });

  it.each([{ bytes: [1, 2] }, { bytes: [1, 2, 3, 4, 5] }])("rejects truncated or oversized actual bodies", async ({ bytes }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media(new Uint8Array(bytes))));
    expect((await relayVideoMedia(request(), path, base)).status).toBe(502);
  });

  it("retains registered raster original consumers while rejecting executable SVG", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media(undefined, { "content-type": "image/png" })));
    expect((await relayVideoMedia(request(), path, base)).status).toBe(206);
    vi.mocked(fetch).mockResolvedValue(media(undefined, { "content-type": "image/svg+xml" }));
    expect((await relayVideoMedia(request(), path, base)).status).toBe(502);
  });

  it("accepts the clipped final range of a file smaller than one block", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media(undefined, { "content-range": "bytes 0-3/4" })));
    const response = await relayVideoMedia(request("token=t", "bytes=0-1048575"), path, base);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("4");
  });

  it("accepts a nonzero short final range", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media(undefined, { "content-range": "bytes 1048576-1048579/1048580" })));
    expect((await relayVideoMedia(request("token=t", "bytes=1048576-2097151"), path, base)).status).toBe(206);
  });

  it("rejects a full-file 200 response without consuming it", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ cancel: cancelled });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect((await relayVideoMedia(request(), path, base)).status).toBe(502);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("bounds even an uncooperative upstream fetch to 30 seconds", async () => {
    vi.useFakeTimers(); const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const pending = relayVideoMedia(request(), path, base);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).status).toBe(504);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("cancels an in-flight body when its client cancels", async () => {
    const cancelled = vi.fn(); const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(media(new ReadableStream({ cancel: cancelled }))));
    const pending = relayVideoMedia(request(undefined, undefined, controller.signal), path, base);
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    controller.abort();
    expect((await pending).status).toBe(408);
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
