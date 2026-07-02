// Bootstrap the OpenCut EditorCore with a backend-generated project.
import { EditorCore } from "@editor/core";
import type { BackendProject } from "./buildProject";
import { buildProject } from "./buildProject";
import { mediaUrl } from "./api";
import type { MediaAsset } from "@editor/lib/media/types";

// Download media files into real Blob/File objects. The canvas renderer uses
// WebCodecs over File objects for video frames, so preview needs these blobs.
async function hydrateAssetFiles(assets: MediaAsset[], bp: BackendProject): Promise<MediaAsset[]> {
  const pathById: Record<string, string> = {};
  for (const m of bp.media) pathById[m.id] = m.file_path;

  // Download in small batches so network isn't flooded by 30+ parallel fetches.
  const BATCH = 6;
  const results: MediaAsset[] = [];
  for (let i = 0; i < assets.length; i += BATCH) {
    const batch = assets.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (asset) => {
        try {
          const url = mediaUrl(pathById[asset.id]);
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (!blob.type.startsWith(`${asset.type}/`)) {
            throw new Error(`Unexpected media type ${blob.type || "unknown"}`);
          }
          const file = new File([blob], asset.name, { type: blob.type });
          return { ...asset, file, url: URL.createObjectURL(blob) };
        } catch (e) {
          console.warn("hydrate media failed", asset.id, e);
          return asset;
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

export async function initEditorWithProject(bp: BackendProject): Promise<EditorCore> {
  EditorCore.reset();
  const editor = EditorCore.getInstance();
  await applyProject(editor, bp);
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

async function applyProject(editor: EditorCore, bp: BackendProject): Promise<void> {
  const { project, assets } = buildProject(bp);

  const hydratedAssets = await hydrateAssetFiles(assets, bp);

  editor.project.setActiveProject({ project });
  editor.scenes.initializeScenes({
    scenes: project.scenes,
    currentSceneId: project.currentSceneId,
  });
  editor.media.setAssets({ assets: hydratedAssets });

  // Debug handle for manual inspection in the browser console.
  (window as unknown as { __editor: EditorCore }).__editor = editor;
}
