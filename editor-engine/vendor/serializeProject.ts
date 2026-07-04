// Serialize the live OpenCut editor state back into the backend's
// BackendProject JSON. Saving the raw TProject (scenes/currentSceneId) bricks
// the next load: fetchProject only understands the tracks/media shape, and
// TProject carries no media file paths at all. This module is the inverse of
// buildProject.ts.
import type { EditorCore } from "@editor/core";
import { filePathByMediaId, segmentIdByElementId, segmentTextByElementId } from "./buildProject";

type RawProject = Record<string, unknown>;

// The project JSON as loaded from the backend (outer dict, before any format
// unwrapping). Preserved so backend-only keys (script/orchestration/mp4_state)
// survive the save round-trip: PUT overwrites video_project wholesale.
let rawLoadedProject: RawProject | null = null;

export function rememberRawProject(raw: RawProject): void {
  rawLoadedProject = raw;
}

function unwrapCaption(content: string): string {
  // buildProject hard-wraps captions with "\n"; store the flat text.
  return (content || "").replace(/\n/g, "");
}

function serializeElement(el: {
  id: string;
  type: string;
  name?: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  mediaId?: string;
  content?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    name: el.name || "",
    startTime: el.startTime,
    duration: el.duration,
    trimStart: el.trimStart ?? 0,
    trimEnd: el.trimEnd ?? 0,
  };
  if (el.mediaId) out.mediaId = el.mediaId;
  if (el.type === "text") out.content = unwrapCaption(el.content || "");
  const segmentId = segmentIdByElementId[el.id];
  if (segmentId) out.segmentId = segmentId;
  const segmentText = segmentTextByElementId[el.id];
  if (segmentText) out.segmentText = segmentText;
  return out;
}

export function serializeBackendProject(editor: EditorCore): RawProject {
  const project = editor.project.getActive();
  const tracks = editor.timeline.getTracks();
  const assets = editor.media.getAssets();

  const referencedMediaIds = new Set<string>();
  let duration = 0;
  const outTracks = tracks.map((t) => {
    const elements = t.elements.map((el) => {
      const serialized = serializeElement(el as never);
      const mediaId = (serialized.mediaId as string) || "";
      if (mediaId) referencedMediaIds.add(mediaId);
      // In this engine `duration` is the timeline occupancy (end = start +
      // duration); trims are source offsets and don't shrink occupancy.
      duration = Math.max(duration, (serialized.startTime as number) + (serialized.duration as number));
      return serialized;
    });
    const track: Record<string, unknown> = {
      id: t.id,
      type: t.type,
      name: t.name,
      elements,
    };
    if (t.type === "video" && t.isMain === false) track.overlay = true;
    return track;
  });

  const media: Record<string, unknown>[] = [];
  for (const asset of assets) {
    if (!referencedMediaIds.has(asset.id)) continue;
    const filePath = filePathByMediaId[asset.id];
    if (!filePath) {
      // Blob-only asset (no backend ref): unsaveable, keep the element but
      // warn — next load falls back to the previous material.
      console.warn("save: media asset has no backend file_path, skipped", asset.id);
      continue;
    }
    const entry: Record<string, unknown> = {
      id: asset.id,
      type: asset.type,
      file_path: filePath,
      name: asset.name,
    };
    if ((asset as { hasAlpha?: boolean }).hasAlpha) entry.hasAlpha = true;
    media.push(entry);
  }

  const raw = rawLoadedProject || {};
  const nested = raw.timeline && typeof raw.timeline === "object" && !Array.isArray(raw.timeline);
  const base = (nested ? (raw.timeline as RawProject) : raw) || {};
  const canvas = project.settings.canvasSize;
  const inner: RawProject = {
    ...base,
    metadata: {
      ...((base.metadata as RawProject) || {}),
      title: project.metadata.name,
      duration: Math.round(duration * 1000) / 1000,
    },
    settings: { fps: project.settings.fps, width: canvas.width, height: canvas.height },
    media,
    tracks: outTracks,
  };
  return nested ? { ...raw, timeline: inner } : inner;
}
