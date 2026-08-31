// Bootstrap the OpenCut EditorCore with a backend-generated project.
import { EditorCore } from "@editor/core";
import type { BackendProject } from "./buildProject";
import { buildProject } from "./buildProject";
import { mediaUrl } from "./api";
import type { MediaAsset } from "@editor/lib/media/types";

// Progress callback while media blobs download (loaded, total).
export type HydrateProgress = (loaded: number, total: number) => void;

// The canvas export renderer needs actual Blob/File objects, not only direct
// playback URLs. Allow a bounded preparation window for a remote source file
// before falling back to direct playback for the editor UI.
const MEDIA_HYDRATION_PREPARATION_TIMEOUT_MS = 60_000;

type MediaHydrationFailureReason = "http" | "mime" | "missing-url" | "network" | "timeout";

type DownloadedMediaBlob = {
  blob: Blob;
  bytes: number;
  contentType: string;
  durationMs: number;
  status: number;
};

class MediaHydrationError extends Error {
  constructor(
    readonly reason: MediaHydrationFailureReason,
    readonly durationMs: number,
    message: string,
    readonly metadata: Partial<Omit<DownloadedMediaBlob, "blob" | "durationMs">> = {},
  ) {
    super(message);
    this.name = "MediaHydrationError";
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function diagnosticUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split(/[?#]/, 1)[0] || url;
  }
}

async function fetchMediaBlob(url: string): Promise<DownloadedMediaBlob> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MEDIA_HYDRATION_PREPARATION_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentType = response.headers.get("content-type") || "unknown";
    if (!response.ok) {
      throw new MediaHydrationError("http", elapsedMs(startedAt), `HTTP ${response.status}`, {
        contentType,
        status: response.status,
      });
    }
    const blob = await response.blob();
    return {
      blob,
      bytes: blob.size,
      contentType: blob.type || contentType,
      durationMs: elapsedMs(startedAt),
      status: response.status,
    };
  } catch (error) {
    if (error instanceof MediaHydrationError) throw error;
    throw new MediaHydrationError(
      timedOut ? "timeout" : "network",
      elapsedMs(startedAt),
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export function disposeEditor(): void {
  EditorCore.reset();
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
): Promise<MediaAsset[]> {
  const playbackUrlById: Record<string, string> = {};
  for (const m of bp.media) {
    playbackUrlById[m.id] = m.playback_url || mediaUrl(m.file_path);
  }

  // Download in small batches so network isn't flooded by 30+ parallel fetches.
  const BATCH = 6;
  const results: MediaAsset[] = [];
  let loaded = 0;
  onProgress?.(0, assets.length);
  for (let i = 0; i < assets.length; i += BATCH) {
    const batch = assets.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (asset) => {
        const url = playbackUrlById[asset.id];
        const startedAt = performance.now();
        try {
          if (!url) throw new MediaHydrationError("missing-url", elapsedMs(startedAt), "Missing media playback URL");
          const downloaded = await fetchMediaBlob(url);
          const { blob } = downloaded;
          if (!blob.type.startsWith(`${asset.type}/`)) {
            throw new MediaHydrationError("mime", downloaded.durationMs, `Unexpected media type ${blob.type || "unknown"}`, {
              bytes: downloaded.bytes,
              contentType: downloaded.contentType,
              status: downloaded.status,
            });
          }
          const file = new File([blob], asset.name, { type: blob.type });
          console.info("media hydration succeeded", {
            assetId: asset.id,
            assetName: asset.name,
            assetType: asset.type,
            bytes: downloaded.bytes,
            contentType: downloaded.contentType,
            durationMs: downloaded.durationMs,
            status: downloaded.status,
            url: diagnosticUrl(url),
          });
          return { ...asset, file, url: URL.createObjectURL(blob) };
        } catch (e) {
          const failure = e instanceof MediaHydrationError
            ? e
            : new MediaHydrationError("network", elapsedMs(startedAt), e instanceof Error ? e.message : String(e));
          console.warn("media hydration failed", {
            assetId: asset.id,
            assetName: asset.name,
            assetType: asset.type,
            bytes: failure.metadata.bytes,
            contentType: failure.metadata.contentType,
            durationMs: failure.durationMs,
            error: failure.message,
            reason: failure.reason,
            status: failure.metadata.status,
            url: url ? diagnosticUrl(url) : undefined,
          });
          return url ? { ...asset, url } : asset;
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
  editor.media.clearAllAssets();
  await applyProject(editor, bp);
  return editor;
}

async function applyProject(editor: EditorCore, bp: BackendProject, onProgress?: HydrateProgress): Promise<void> {
  const { project, assets } = buildProject(bp);

  const hydratedAssets = await hydrateAssetFiles(assets, bp, onProgress);

  editor.project.setActiveProject({ project });
  editor.scenes.initializeScenes({
    scenes: project.scenes,
    currentSceneId: project.currentSceneId,
  });
  editor.media.setAssets({ assets: hydratedAssets });

  // Debug handle for manual inspection in the browser console.
  (window as unknown as { __editor: EditorCore }).__editor = editor;
}
