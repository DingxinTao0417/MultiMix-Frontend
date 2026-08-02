// Bootstrap the OpenCut EditorCore with a backend-generated project.
import { EditorCore } from "@editor/core";
import type { BackendProject } from "./buildProject";
import { buildProject } from "./buildProject";
import { mediaUrl } from "./api";
import type { MediaAsset } from "@editor/lib/media/types";

// Progress callback while media blobs download (loaded, total).
export type HydrateProgress = (loaded: number, total: number) => void;

// A playable project must not wait forever for one remote media connection.
// This is a no-response bound per resource, not a cap on project playback.
const MEDIA_HYDRATION_IDLE_TIMEOUT_MS = 90_000;

async function fetchMediaBlob(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MEDIA_HYDRATION_IDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
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
        try {
          if (!url) throw new Error("Missing media playback URL");
          const blob = await fetchMediaBlob(url);
          if (!blob.type.startsWith(`${asset.type}/`)) {
            throw new Error(`Unexpected media type ${blob.type || "unknown"}`);
          }
          const file = new File([blob], asset.name, { type: blob.type });
          return { ...asset, file, url: URL.createObjectURL(blob) };
        } catch (e) {
          console.warn("hydrate media failed", asset.id, e);
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
