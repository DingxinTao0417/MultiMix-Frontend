// Bootstrap the OpenCut EditorCore with a backend-generated project.
import { EditorCore } from "@editor/core";
import type { BackendProject } from "./buildProject";
import { buildProject } from "./buildProject";
import { mediaUrl } from "./api";
import type { MediaAsset } from "@editor/lib/media/types";

// Fetch a backend media URL into a real File so mediabunny (BlobSource) can
// decode it for preview/export. Clips are short, so download cost is low.
async function hydrateAssetFiles(assets: MediaAsset[], bp: BackendProject): Promise<MediaAsset[]> {
  const pathById: Record<string, string> = {};
  for (const m of bp.media) pathById[m.id] = m.file_path;

  return Promise.all(
    assets.map(async (asset) => {
      try {
        const url = mediaUrl(pathById[asset.id]);
        const res = await fetch(url);
        const blob = await res.blob();
        const file = new File([blob], asset.name, { type: blob.type });
        return { ...asset, file, url: URL.createObjectURL(blob) };
      } catch (e) {
        console.warn("hydrate media failed", asset.id, e);
        return asset; // keep URL-only asset; thumbnail may still work
      }
    })
  );
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
  const hydrated = await hydrateAssetFiles(assets, bp);
  editor.project.setActiveProject({ project });
  editor.scenes.initializeScenes({
    scenes: project.scenes,
    currentSceneId: project.currentSceneId,
  });
  editor.media.setAssets({ assets: hydrated });
  // Debug handle for manual inspection in the browser console.
  (window as unknown as { __editor: EditorCore }).__editor = editor;
}
