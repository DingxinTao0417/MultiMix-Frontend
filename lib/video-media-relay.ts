const API_ORIGIN = "https://multimix-backend-production.up.railway.app";
const MAX_RANGE_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const RASTER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "image/tiff", "image/x-icon", "image/vnd.microsoft.icon"]);

function failure(status: number): Response {
  return Response.json({ error: "Media delivery unavailable" }, { status, headers: PRIVATE_HEADERS });
}

function positiveId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function mediaPath(segments: string[]): string | null {
  if (segments.length === 4 && segments[0] === "projects" && positiveId(segments[1])
    && segments[2] === "media" && positiveId(segments[3])) return `/v1/video/${segments.join("/")}`;
  if (segments.length === 3 && segments[0] === "bgm" && segments[1] === "media"
    && /^[A-Za-z0-9_-]{1,160}$/.test(segments[2])) return `/v1/video/${segments.join("/")}`;
  return null;
}

// This is an existing signed-media delivery adapter, not a general URL proxy.
export async function relayVideoMedia(request: Request, segments: string[], apiBase: string | undefined): Promise<Response> {
  if (request.method !== "GET") return failure(405);
  let base: URL;
  try {
    base = new URL(apiBase || "");
    const localDevelopmentApi = !process.env.VERCEL && base.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if ((base.origin !== API_ORIGIN && !localDevelopmentApi) || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
      return failure(503);
    }
  } catch { return failure(503); }
  const path = mediaPath(segments);
  if (!path) return failure(404);
  const query = new URL(request.url).searchParams;
  const tokens = query.getAll("token");
  if (tokens.length !== 1 || !tokens[0] || tokens[0].length > 4096 || [...query.keys()].some(key => key !== "token")) {
    return failure(400);
  }
  const range = request.headers.get("range") || "";
  const match = /^bytes=(\d+)-(\d+)$/.exec(range);
  if (!match) return failure(416);
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start + 1 > MAX_RANGE_BYTES) {
    return failure(416);
  }
  if (request.signal.aborted) return failure(408);

  const upstreamUrl = new URL(path, base);
  upstreamUrl.search = new URL(request.url).search;
  const controller = new AbortController();
  let timedOut = false, complete = false;
  let upstream: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let receivedBytes = 0;
  let reason = "upstream";
  let rejectInterrupted!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const interrupt = () => {
    controller.abort();
    rejectInterrupted(new DOMException("Media delivery cancelled", "AbortError"));
  };
  request.signal.addEventListener("abort", interrupt, { once: true });
  const timeout = setTimeout(() => { timedOut = true; interrupt(); }, UPSTREAM_TIMEOUT_MS);
  try {
    upstream = await Promise.race([fetch(upstreamUrl, {
      headers: { Range: range, "Accept-Encoding": "identity" },
      signal: controller.signal, cache: "no-store", redirect: "error",
    }), interrupted]);
    if ([401, 403, 404, 416].includes(upstream.status)) return failure(upstream.status);
    reason = "contract";
    if (upstream.status !== 206 || upstream.redirected) throw new Error("Invalid media response status");
    const contentRange = upstream.headers.get("content-range") || "";
    const parsedRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    if (!parsedRange) throw new Error("Invalid media range");
    const responseStart = Number(parsedRange[1]), responseEnd = Number(parsedRange[2]), total = Number(parsedRange[3]);
    if (![responseStart, responseEnd, total].every(Number.isSafeInteger) || total <= start
      || responseStart !== start || responseEnd !== Math.min(end, total - 1)) throw new Error("Mismatched media range");
    const expectedBytes = responseEnd - responseStart + 1;
    const declaredLength = upstream.headers.get("content-length") || "";
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes) throw new Error("Mismatched media length");
    const contentType = upstream.headers.get("content-type") || "";
    const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
    if (!/^(video|audio)\/[a-z0-9.+-]+$/.test(mediaType) && !RASTER_IMAGE_TYPES.has(mediaType)) throw new Error("Invalid media type");
    if (!upstream.body) throw new Error("Missing media body");
    reason = "body";
    const bytes = new Uint8Array(expectedBytes);
    reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      if (receivedBytes + value.byteLength > expectedBytes) throw new Error("Oversized media body");
      bytes.set(value, receivedBytes); receivedBytes += value.byteLength;
    }
    if (receivedBytes !== expectedBytes) throw new Error("Incomplete media body");
    complete = true;
    return new Response(bytes, { status: 206, headers: {
      ...PRIVATE_HEADERS, "Content-Type": contentType, "Content-Range": contentRange,
      "Content-Length": String(expectedBytes), "Accept-Ranges": "bytes",
    } });
  } catch {
    const status = timedOut ? 504 : request.signal.aborted ? 408 : 502;
    console.warn("[MediaRelay] " + JSON.stringify({ status, reason: timedOut ? "timeout" : request.signal.aborted ? "cancelled" : reason, receivedBytes }));
    return failure(status);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", interrupt);
    if (!complete) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
      else void upstream?.body?.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}
