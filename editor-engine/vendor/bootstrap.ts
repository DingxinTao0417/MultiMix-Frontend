// Bootstrap the OpenCut EditorCore with a backend-generated project.
import { EditorCore } from "@editor/core";
import type { BackendProject } from "./buildProject";
import { buildProject } from "./buildProject";
import { API_BASE, mediaUrl } from "./api";
import type { MediaAsset } from "@editor/lib/media/types";
import { isBgmMedia, isBgmTrack } from "@/app/editor/bgm-project-patch";
import { MEDIA_HYDRATION_BATCH_SIZE, MEDIA_TOTAL_TIMEOUT_MS } from "../media-hydration-contract";

// Progress callback while media blobs download (loaded, total).
export type HydrateProgress = (loaded: number, total: number) => void;

// Preview and export both require complete, validated File objects for canvas decoding.
type MediaHydrationFailureReason = "http" | "mime" | "missing-url" | "network" | "range" | "timeout";

const MEDIA_RANGE_CHUNK_BYTES = 1024 * 1024;
const MEDIA_RANGE_REQUEST_TIMEOUT_MS = 60_000;
const authorizedPlaybackUrlByMediaId: Record<string, string> = {};

function clearAuthorizedPlaybackUrls(): void {
  for (const mediaId of Object.keys(authorizedPlaybackUrlByMediaId)) {
    delete authorizedPlaybackUrlByMediaId[mediaId];
  }
}

function resolveAuthorizedPlaybackUrl(playbackUrl: string): string {
  try {
    const apiBase = new URL(API_BASE);
    const candidate = new URL(playbackUrl, apiBase);
    const isOriginalMedia = /^\/v1\/video\/projects\/\d+\/media\/\d+$/.test(candidate.pathname);
    if (!candidate.pathname.startsWith("/v1/video/bgm/media/") && !isOriginalMedia) return playbackUrl;
    return `/api/video-media/${candidate.pathname.slice("/v1/video/".length)}${candidate.search}${candidate.hash}`;
  } catch {
    return playbackUrl;
  }
}

export type ExportMediaHydrationOptions = {
  chunkBytes?: number;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
};

type DownloadedMediaBlob = {
  blob: Blob;
  bytes: number;
  contentType: string;
  durationMs: number;
  status: number;
};

type MediaFailureBoundary = "await_response" | "read_body" | "validate";
type MediaFailureMetadata = Partial<Omit<DownloadedMediaBlob, "blob" | "durationMs">> & {
  failedAt?: MediaFailureBoundary;
  rangeStart?: number;
  requestTimeoutMs?: number;
  receivedBytes?: number;
  expectedBytes?: number;
  bodyIdleMs?: number;
};
type MediaLoadEvent = {
  stage: "preview" | "export";
  outcome: "prepared" | "failed";
  mediaIndex: number;
  mediaType: string;
  durationMs: number;
  bytes?: number;
  status?: number;
  reason?: MediaHydrationFailureReason;
  failedAt?: MediaFailureBoundary;
  rangeStart?: number;
  requestTimeoutMs?: number;
  receivedBytes?: number;
  expectedBytes?: number;
  bodyIdleMs?: number;
};

function reportMediaLoad(level: "info" | "warn", event: MediaLoadEvent): void {
  try {
    console[level]("[MediaLoad] " + JSON.stringify({
      timestamp: new Date().toISOString(),
      stage: event.stage, outcome: event.outcome,
      mediaIndex: event.mediaIndex, mediaType: event.mediaType,
      durationMs: event.durationMs, bytes: event.bytes, status: event.status,
      reason: event.reason, failedAt: event.failedAt,
      rangeStart: event.rangeStart, requestTimeoutMs: event.requestTimeoutMs,
      receivedBytes: event.receivedBytes, expectedBytes: event.expectedBytes, bodyIdleMs: event.bodyIdleMs,
    }));
  } catch { /* Diagnostics must not change preparation results. */ }
}

class MediaHydrationError extends Error {
  constructor(
    readonly reason: MediaHydrationFailureReason,
    readonly durationMs: number,
    message: string,
    readonly metadata: MediaFailureMetadata = {},
  ) {
    super(message);
    this.name = "MediaHydrationError";
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function normalizedContentType(response: Response, blob: Blob): string {
  return (blob.type || response.headers.get("content-type") || "unknown")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function assertMediaMime(asset: MediaAsset, contentType: string, durationMs: number, status: number): void {
  if (contentType.startsWith(`${asset.type}/`)) return;
  throw new MediaHydrationError("mime", durationMs, `Unexpected media type ${contentType || "unknown"}`, {
    contentType,
    status,
  });
}

async function fetchMediaPart(
  url: string,
  range: string,
  timeoutMs: number,
  remainingTotalMs: number,
): Promise<{ response: Response; blob: Blob }> {
  const controller = new AbortController();
  const startedAt = performance.now();
  let failedAt: MediaFailureBoundary = "await_response";
  let observedStatus: number | undefined;
  let timedOut = false;
  let deadlineExceeded = false;
  let receivedBytes = 0;
  let expectedBytes: number | undefined;
  let lastProgressAt = startedAt;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let reachedEnd = false;
  let rejectInterrupted!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const interrupt = () => {
    timedOut = true;
    controller.abort();
    rejectInterrupted(new DOMException("Media reception aborted", "AbortError"));
  };
  let inactivityTimeout = window.setTimeout(interrupt, timeoutMs);
  const resetInactivityTimeout = () => {
    window.clearTimeout(inactivityTimeout);
    inactivityTimeout = window.setTimeout(interrupt, timeoutMs);
  };
  const totalTimeout = window.setTimeout(() => {
    deadlineExceeded = true;
    interrupt();
  }, remainingTotalMs);
  try {
    const response = await Promise.race([fetch(url, {
      headers: { Range: range },
      signal: controller.signal,
    }), interrupted]);
    observedStatus = response.status;
    failedAt = "read_body";
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
      const length = Number(declaredLength);
      if (Number.isSafeInteger(length)) expectedBytes = length;
    }
    lastProgressAt = performance.now();
    resetInactivityTimeout();
    const parts: BlobPart[] = [];
    reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), interrupted]);
        if (done) { reachedEnd = true; break; }
        if (value.byteLength === 0) continue;
        parts.push(value.slice().buffer);
        receivedBytes += value.byteLength;
        lastProgressAt = performance.now();
        resetInactivityTimeout();
      }
    } else {
      reachedEnd = true;
    }
    const blob = new Blob(parts, { type: response.headers.get("content-type") || "" });
    return { response, blob };
  } catch (error) {
    throw new MediaHydrationError(
      timedOut ? "timeout" : "network",
      elapsedMs(startedAt),
      timedOut
        ? deadlineExceeded ? "Media hydration exceeded its total deadline" : `Media range request timed out after ${timeoutMs}ms without progress`
        : error instanceof Error ? error.message : String(error),
      {
        failedAt, status: observedStatus, rangeStart: Number(range.slice(6).split("-", 1)[0]), requestTimeoutMs: timeoutMs,
        receivedBytes: failedAt === "read_body" ? receivedBytes : undefined,
        expectedBytes, bodyIdleMs: failedAt === "read_body" ? elapsedMs(lastProgressAt) : undefined,
      },
    );
  } finally {
    window.clearTimeout(inactivityTimeout);
    window.clearTimeout(totalTimeout);
    if (!reachedEnd) {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}

async function fetchPreparedMediaBlob(
  asset: MediaAsset,
  url: string,
  options: ExportMediaHydrationOptions,
): Promise<DownloadedMediaBlob> {
  const startedAt = performance.now();
  const chunkBytes = options.chunkBytes ?? MEDIA_RANGE_CHUNK_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? MEDIA_RANGE_REQUEST_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? MEDIA_TOTAL_TIMEOUT_MS;
  if (![chunkBytes, requestTimeoutMs, totalTimeoutMs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new MediaHydrationError("range", elapsedMs(startedAt), "Media hydration limits must be positive integers");
  }

  const chunks: Blob[] = [];
  let nextStart = 0;
  let totalSize: number | null = null;
  let expectedContentType: string | null = null;
  let finalStatus = 0;

  while (totalSize === null || nextStart < totalSize) {
    const remainingMs = totalTimeoutMs - elapsedMs(startedAt);
    if (remainingMs <= 0) {
      throw new MediaHydrationError("timeout", elapsedMs(startedAt), "Media hydration exceeded its total deadline");
    }
    const requestedEnd = nextStart + chunkBytes - 1;
    const requestedRange = `bytes=${nextStart}-${requestedEnd}`;
    const { response, blob } = await fetchMediaPart(
      url,
      requestedRange,
      requestTimeoutMs,
      remainingMs,
    );
    finalStatus = response.status;
    const contentType = normalizedContentType(response, blob);
    if (response.status !== 206 && !(response.status === 200 && nextStart === 0)) {
      throw new MediaHydrationError("http", elapsedMs(startedAt), `HTTP ${response.status}`, {
        contentType,
        status: response.status,
      });
    }
    assertMediaMime(asset, contentType, elapsedMs(startedAt), response.status);

    if (response.status === 200 && nextStart === 0) {
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && Number(declaredLength) !== blob.size) {
        throw new MediaHydrationError(
          "range",
          elapsedMs(startedAt),
          `Full media response length ${blob.size} did not match Content-Length ${declaredLength}`,
        );
      }
      return {
        blob,
        bytes: blob.size,
        contentType,
        durationMs: elapsedMs(startedAt),
        status: response.status,
      };
    }
    const contentRange = response.headers.get("content-range") || "";
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(contentRange);
    if (!match) {
      throw new MediaHydrationError("range", elapsedMs(startedAt), `Invalid Content-Range ${contentRange || "missing"}`);
    }
    const responseStart = Number(match[1]);
    const responseEnd = Number(match[2]);
    const responseTotal = Number(match[3]);
    const expectedEnd = Math.min(requestedEnd, responseTotal - 1);
    if (
      !Number.isSafeInteger(responseStart)
      || !Number.isSafeInteger(responseEnd)
      || !Number.isSafeInteger(responseTotal)
      || responseTotal <= 0
      || responseStart !== nextStart
      || responseEnd !== expectedEnd
    ) {
      throw new MediaHydrationError(
        "range",
        elapsedMs(startedAt),
        `Content-Range ${contentRange} did not match requested ${requestedRange}`,
      );
    }
    if (totalSize !== null && responseTotal !== totalSize) {
      throw new MediaHydrationError("range", elapsedMs(startedAt), "Media total size changed between range responses");
    }
    const expectedBytes = responseEnd - responseStart + 1;
    const declaredLength = response.headers.get("content-length");
    if (blob.size !== expectedBytes || (declaredLength !== null && Number(declaredLength) !== blob.size)) {
      throw new MediaHydrationError("range", elapsedMs(startedAt), "Media range body length did not match its headers");
    }
    if (expectedContentType !== null && contentType !== expectedContentType) {
      throw new MediaHydrationError("mime", elapsedMs(startedAt), "Media type changed between range responses");
    }

    totalSize = responseTotal;
    expectedContentType = contentType;
    chunks.push(blob);
    nextStart = responseEnd + 1;
  }

  const blob = new Blob(chunks, { type: expectedContentType || `${asset.type}/unknown` });
  if (blob.size !== totalSize) {
    throw new MediaHydrationError("range", elapsedMs(startedAt), "Assembled media size did not match Content-Range total");
  }
  return {
    blob,
    bytes: blob.size,
    contentType: expectedContentType || blob.type,
    durationMs: elapsedMs(startedAt),
    status: finalStatus,
  };
}

export function disposeEditor(): void {
  EditorCore.reset();
  clearAuthorizedPlaybackUrls();
  if (typeof window !== "undefined") {
    const editorWindow = window as Window & { __editor?: EditorCore };
    delete editorWindow.__editor;
  }
}

// Download media files into real Blob/File objects. The canvas renderer uses
// WebCodecs over File objects for video frames, so preview needs these blobs.
export async function hydrateAssetFiles(
  assets: MediaAsset[],
  bp: BackendProject,
  onProgress?: HydrateProgress,
  options: { preservePlaybackUrls?: boolean } = {},
): Promise<MediaAsset[]> {
  if (!options.preservePlaybackUrls) clearAuthorizedPlaybackUrls();
  const playbackUrlById: Record<string, string> = {};
  for (const m of bp.media) {
    const authorizedPlaybackUrl = m.playback_url
      ? resolveAuthorizedPlaybackUrl(m.playback_url)
      : "";
    playbackUrlById[m.id] = authorizedPlaybackUrl || mediaUrl(m.file_path);
    if (authorizedPlaybackUrl) authorizedPlaybackUrlByMediaId[m.id] = authorizedPlaybackUrl;
  }

  // Download in small batches so network isn't flooded by 30+ parallel fetches.
  const results: MediaAsset[] = [];
  let loaded = 0;
  onProgress?.(0, assets.length);
  for (let i = 0; i < assets.length; i += MEDIA_HYDRATION_BATCH_SIZE) {
    const batch = assets.slice(i, i + MEDIA_HYDRATION_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (asset, batchIndex) => {
        const url = playbackUrlById[asset.id];
        const startedAt = performance.now();
        try {
          if (!url) throw new MediaHydrationError("missing-url", elapsedMs(startedAt), "Missing media playback URL");
          const downloaded = await fetchPreparedMediaBlob(asset, url, {});
          const { blob } = downloaded;
          if (!blob.type.startsWith(`${asset.type}/`)) {
            throw new MediaHydrationError("mime", downloaded.durationMs, `Unexpected media type ${blob.type || "unknown"}`, {
              bytes: downloaded.bytes,
              contentType: downloaded.contentType,
              status: downloaded.status,
            });
          }
          const file = new File([blob], asset.name, { type: blob.type });
          reportMediaLoad("info", {
            stage: "preview", outcome: "prepared", mediaIndex: i + batchIndex, mediaType: asset.type,
            bytes: downloaded.bytes,
            durationMs: downloaded.durationMs,
            status: downloaded.status,
          });
          return { ...asset, file, url: URL.createObjectURL(blob) };
        } catch (e) {
          const failure = e instanceof MediaHydrationError
            ? e
            : new MediaHydrationError("network", elapsedMs(startedAt), e instanceof Error ? e.message : String(e));
          reportMediaLoad("warn", {
            stage: "preview", outcome: "failed", mediaIndex: i + batchIndex, mediaType: asset.type,
            bytes: failure.metadata.bytes,
            durationMs: failure.durationMs,
            reason: failure.reason,
            status: failure.metadata.status,
            failedAt: failure.metadata.failedAt ?? "validate",
            rangeStart: failure.metadata.rangeStart,
            requestTimeoutMs: failure.metadata.requestTimeoutMs,
            receivedBytes: failure.metadata.receivedBytes,
            expectedBytes: failure.metadata.expectedBytes,
            bodyIdleMs: failure.metadata.bodyIdleMs,
          });
          throw failure;
        } finally {
          loaded += 1;
          onProgress?.(loaded, assets.length);
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

// Export reuses files prepared by preview and fetches only missing files through
// the same bounded range and integrity contract.
export async function hydrateAssetFilesForExport(
  assets: MediaAsset[],
  bp: BackendProject,
  options: ExportMediaHydrationOptions = {},
): Promise<MediaAsset[]> {
  const playbackUrlById: Record<string, string> = {};
  for (const media of bp.media) {
    playbackUrlById[media.id] =
      (media.playback_url ? resolveAuthorizedPlaybackUrl(media.playback_url) : "")
      || authorizedPlaybackUrlByMediaId[media.id]
      || mediaUrl(media.file_path);
  }

  const results: MediaAsset[] = [];
  for (const [mediaIndex, asset] of assets.entries()) {
    if (asset.file.size > 0) {
      results.push(asset);
      continue;
    }
    const url = playbackUrlById[asset.id];
    if (!url) {
      throw new MediaHydrationError("missing-url", 0, `Missing export media URL for ${asset.name}`);
    }
    try {
      const downloaded = await fetchPreparedMediaBlob(asset, url, options);
      const file = new File([downloaded.blob], asset.name, { type: downloaded.contentType });
      results.push({ ...asset, file, url: URL.createObjectURL(downloaded.blob) });
      reportMediaLoad("info", {
        stage: "export", outcome: "prepared", mediaIndex, mediaType: asset.type,
        bytes: downloaded.bytes,
        durationMs: downloaded.durationMs,
        status: downloaded.status,
      });
    } catch (error) {
      if (error instanceof MediaHydrationError) reportMediaLoad("warn", {
        stage: "export", outcome: "failed", mediaIndex, mediaType: asset.type,
        durationMs: error.durationMs, bytes: error.metadata.bytes, status: error.metadata.status,
        reason: error.reason, failedAt: error.metadata.failedAt ?? "validate",
        rangeStart: error.metadata.rangeStart, requestTimeoutMs: error.metadata.requestTimeoutMs,
        receivedBytes: error.metadata.receivedBytes, expectedBytes: error.metadata.expectedBytes, bodyIdleMs: error.metadata.bodyIdleMs,
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`导出素材“${asset.name}”准备失败：${message}`, { cause: error });
    }
  }
  return results;
}

export async function initEditorWithProject(bp: BackendProject, onProgress?: HydrateProgress): Promise<EditorCore> {
  disposeEditor();
  const editor = EditorCore.getInstance();
  await applyProject(editor, bp, onProgress);
  return editor;
}

// Update an existing editor instance WITHOUT resetting the singleton. Used by
// streaming so mounted Timeline/Preview components stay attached and just
// re-render via manager notify() as new segments arrive.
export async function updateEditorProject(bp: BackendProject): Promise<EditorCore> {
  const editor = EditorCore.getInstance();
  await applyProject(editor, bp);
  return editor;
}

// Hydrate only music, then read the live tracks after the await. Scene resets
// would discard edits made while either the API or audio download was pending.
export async function updateEditorBgm(bp: BackendProject, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) throw new DOMException("Music update superseded", "AbortError");
  const editor = EditorCore.getInstance();
  const patch = { ...bp, tracks: bp.tracks.filter(isBgmTrack), media: bp.media.filter(isBgmMedia) };
  const { project, assets } = buildProject(patch, { preserveMappings: true });
  const hydratedAssets = await hydrateAssetFiles(assets, patch, undefined, { preservePlaybackUrls: true });
  if (!isCurrent()) throw new DOMException("Music update superseded", "AbortError");
  editor.media.setAssets({ assets: [
    ...editor.media.getAssets().filter((asset) => !isBgmMedia({ id: asset.id, file_path: "" })),
    ...hydratedAssets,
  ] });
  editor.timeline.updateTracks([
    ...editor.timeline.getTracks().filter((track) => !isBgmTrack(track)),
    ...project.scenes[0].tracks,
  ]);
}

async function applyProject(editor: EditorCore, bp: BackendProject, onProgress?: HydrateProgress): Promise<void> {
  const { project, assets } = buildProject(bp);

  const hydratedAssets = await hydrateAssetFiles(assets, bp, onProgress);

  editor.media.clearAllAssets();
  editor.project.setActiveProject({ project });
  editor.scenes.initializeScenes({
    scenes: project.scenes,
    currentSceneId: project.currentSceneId,
  });
  editor.media.setAssets({ assets: hydratedAssets });

  // Debug handle for manual inspection in the browser console.
  (window as unknown as { __editor: EditorCore }).__editor = editor;
}
