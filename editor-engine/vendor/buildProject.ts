// Convert backend /generate JSON into OpenCut's TProject + MediaAsset[].
import type { TProject } from "@editor/lib/project/types";
import type {
  TScene,
  TimelineTrack,
  VideoElement,
  ImageElement,
  AudioElement,
  TextElement,
} from "@editor/lib/timeline/types";
import type { MediaAsset } from "@editor/lib/media/types";
import { mediaUrl } from "./api";

// Backend shapes (loose; mirror backend/timeline.py + pipeline.py output).
export interface BackendMedia {
  id: string;
  type: "video" | "image" | "audio";
  file_path: string;
  name: string;
  hasAlpha?: boolean;   // MG overlay WebM carries a transparency channel
}
export type SafeRegion = { x: number; y: number; width: number; height: number };

export interface BackendElement {
  id: string;
  type: "video" | "image" | "audio" | "text";
  name?: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  mediaId?: string;
  content?: string;
  segmentId?: string;
  segmentText?: string;
  displayText?: string;
  focusText?: string;
  safeRegion?: SafeRegion;
  muted?: boolean;      // stock video clips are muted so their source audio doesn't talk over narration
}
export interface BackendTrack {
  id: string;
  type: "video" | "audio" | "text";
  name: string;
  elements: BackendElement[];
  overlay?: boolean;    // MG overlay track: composited above the main video, isMain=false
}
export interface BackendProject {
  metadata: {
    title: string;
    duration: number;
    duration_contract?: {
      target_seconds: number;
      tolerance_ratio: number;
      min_seconds: number;
      max_seconds: number;
    };
    [key: string]: unknown;
  };
  settings: { fps: number; width: number; height: number };
  media: BackendMedia[];
  tracks: BackendTrack[];
  script?: { content: string; keyword: string; estimated_label: string };
}

const IDENTITY_TRANSFORM = { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 };
type SegmentWindow = { startTime: number; duration: number };

// Subtitle style — adjustable from the style panel; buildProject reads the
// current value each time it rebuilds the project.
export interface SubtitleStyle {
  fontFamily: string;
  color: string;
  bgEnabled: boolean;
  bgColor: string;
  maxLineChars: number;   // hard-wrap budget per line
  sizeScale: number;      // multiplier on the auto-fit font size
  bottomOffset: number;   // vertical position as fraction of canvas height (from center)
}

export const defaultSubtitleStyle: SubtitleStyle = {
  fontFamily: "sans-serif",
  color: "#ffffff",
  bgEnabled: false,
  bgColor: "#000000aa",
  maxLineChars: 16,
  sizeScale: 1,
  bottomOffset: 0.34,
};

// Module-level current style (mutated by the style panel before re-building).
let subtitleStyle: SubtitleStyle = { ...defaultSubtitleStyle };
export function setSubtitleStyle(s: SubtitleStyle) { subtitleStyle = s; }
export function getSubtitleStyle(): SubtitleStyle { return subtitleStyle; }

// Hard-wrap a caption into lines of at most maxChars, breaking preferably at
// punctuation, joining lines with "\n" (the only break OpenCut honors).
function wrapCaption(text: string, maxChars: number): string {
  const t = (text || "").trim();
  if (!t) return "";
  const lines: string[] = [];
  for (const sourceLine of t.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    let cur = "";
    for (const ch of sourceLine) {
      cur += ch;
      const atPunct = "，。！？；、,.!?;".includes(ch);
      if (cur.length >= maxChars || (atPunct && cur.length >= maxChars * 0.6)) {
        lines.push(cur);
        cur = "";
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.join("\n");
}

// Side map: element id -> segment text (OpenCut element type has no such field).
// Used by the replace-material panel to re-search by the segment's script text.
export const segmentTextByElementId: Record<string, string> = {};

// Side maps for saving: OpenCut's types carry neither the backend file_path nor
// the segment id, but both must survive the save round-trip (media refs feed
// the media proxy; segment ids anchor MG overlays).
export const filePathByMediaId: Record<string, string> = {};
export const segmentIdByElementId: Record<string, string> = {};
export const safeRegionByElementId: Record<string, SafeRegion> = {};
export const displayTextByElementId: Record<string, string> = {};
export const focusTextByElementId: Record<string, string> = {};

// A placeholder File to satisfy the MediaAsset type; rendering reads `url`, not bytes.
function placeholderFile(name: string): File {
  return new File([], name);
}

export function buildMediaAssets(bp: BackendProject): MediaAsset[] {
  for (const m of bp.media) filePathByMediaId[m.id] = m.file_path;
  return bp.media.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    width: bp.settings.width,
    height: bp.settings.height,
    hasAlpha: m.hasAlpha,
    file: placeholderFile(m.name),
    url: mediaUrl(m.file_path),
    thumbnailUrl: m.type !== "audio" ? mediaUrl(m.file_path) : undefined,
  }));
}

function buildSegmentWindows(tracks: BackendTrack[]): Record<string, SegmentWindow> {
  const windows: Record<string, SegmentWindow> = {};

  for (const track of tracks) {
    if (track.overlay) continue;

    for (const element of track.elements) {
      if (!element.segmentId) continue;
      const existing = windows[element.segmentId];
      const startTime = existing
        ? Math.min(existing.startTime, element.startTime)
        : element.startTime;
      const endTime = existing
        ? Math.max(existing.startTime + existing.duration, element.startTime + element.duration)
        : element.startTime + element.duration;
      windows[element.segmentId] = {
        startTime,
        duration: Math.max(0, endTime - startTime),
      };
    }
  }

  return windows;
}

function clampOverlayElementToSegment(
  element: BackendElement,
  segmentWindows: Record<string, SegmentWindow>,
): BackendElement {
  if (!element.segmentId) return element;
  const segmentWindow = segmentWindows[element.segmentId];
  if (!segmentWindow) return element;

  const startTime = Math.max(segmentWindow.startTime, element.startTime);
  const endTime = Math.min(
    segmentWindow.startTime + segmentWindow.duration,
    element.startTime + element.duration,
  );
  return { ...element, startTime, duration: Math.max(0, endTime - startTime) };
}

function buildTracks(bp: BackendProject): TimelineTrack[] {
  const tracks: TimelineTrack[] = [];
  const segmentWindows = buildSegmentWindows(bp.tracks);

  for (const t of bp.tracks) {
    const sourceElements = t.overlay
      ? t.elements.map((element) => clampOverlayElementToSegment(element, segmentWindows))
      : t.elements;

    for (const e of sourceElements) {
      if (e.segmentId) segmentIdByElementId[e.id] = e.segmentId;
      if (e.safeRegion) safeRegionByElementId[e.id] = e.safeRegion;
      if (e.displayText) displayTextByElementId[e.id] = e.displayText;
      if (e.focusText) focusTextByElementId[e.id] = e.focusText;
    }
    if (t.type === "video") {
      const elements = sourceElements.map((e): VideoElement | ImageElement => {
        if (e.segmentText) segmentTextByElementId[e.id] = e.segmentText;
        const base = {
          id: e.id,
          name: e.name || e.segmentText?.slice(0, 20) || "clip",
          duration: e.duration,
          startTime: e.startTime,
          trimStart: e.trimStart ?? 0,
          trimEnd: e.trimEnd ?? 0,
          transform: { ...IDENTITY_TRANSFORM },
          opacity: 1,
        };
        if (e.type === "image") {
          return { ...base, type: "image", mediaId: e.mediaId || "" } as ImageElement;
        }
        // Stock video clips carry their own voices/music. Narration lives on the
        // audio track, so mute the clip's source audio unless the backend
        // explicitly kept it (e.g. a user-provided clip meant to be heard).
        return { ...base, type: "video", mediaId: e.mediaId || "", muted: e.muted !== false } as VideoElement;
      });
      tracks.push({
        id: t.id, name: t.name, type: "video",
        // Overlay tracks (MG effects) are non-main so they composite ABOVE the
        // main video via scene-builder's track ordering.
        elements, isMain: !t.overlay, muted: false, hidden: false,
      });
    } else if (t.type === "audio") {
      const elements = sourceElements.map((e): AudioElement => ({
        id: e.id,
        name: e.name || "audio",
        type: "audio",
        sourceType: "upload",
        mediaId: e.mediaId || "",
        duration: e.duration,
        startTime: e.startTime,
        trimStart: e.trimStart ?? 0,
        trimEnd: e.trimEnd ?? 0,
        volume: 1,
      }));
      tracks.push({ id: t.id, name: t.name, type: "audio", elements, muted: false });
    } else if (t.type === "text") {
      // OpenCut renders text as scaledPx = fontSize * (canvasHeight / 90) and only
      // breaks lines on "\n" (no auto-wrap). So we pick a per-line char budget,
      // hard-wrap the sentence into lines, and size the font to that budget.
      const style = subtitleStyle;
      const maxLineChars = style.maxLineChars;
      const targetPx = (bp.settings.width * 0.9) / maxLineChars;
      const fontSize = Math.max(2, (targetPx * 90) / bp.settings.height) * style.sizeScale;
      const elements = sourceElements.map((e): TextElement => ({
        id: e.id,
        name: e.name || "text",
        type: "text",
        content: wrapCaption(e.content || "", maxLineChars),
        duration: e.duration,
        startTime: e.startTime,
        trimStart: e.trimStart ?? 0,
        trimEnd: e.trimEnd ?? 0,
        fontSize,
        fontFamily: style.fontFamily,
        color: style.color,
        background: style.bgEnabled
          ? { enabled: true, color: style.bgColor, cornerRadius: 6, paddingX: 12, paddingY: 6 }
          : { enabled: false, color: "#000000" },
        textAlign: "center",
        fontWeight: "bold",
        fontStyle: "normal",
        textDecoration: "none",
        transform: { ...IDENTITY_TRANSFORM, position: { x: 0, y: Math.round(bp.settings.height * style.bottomOffset) } },
        opacity: 1,
      }));
      tracks.push({ id: t.id, name: t.name, type: "text", elements, hidden: false });
    }
  }
  return tracks;
}

export function buildProject(bp: BackendProject): { project: TProject; assets: MediaAsset[] } {
  for (const map of [
    filePathByMediaId,
    segmentIdByElementId,
    segmentTextByElementId,
    safeRegionByElementId,
    displayTextByElementId,
    focusTextByElementId,
  ]) {
    for (const key of Object.keys(map)) delete map[key];
  }
  const now = new Date();
  const tracks = buildTracks(bp);
  const scene: TScene = {
    id: "scene-main",
    name: "Main",
    isMain: true,
    tracks,
    bookmarks: [],
    createdAt: now,
    updatedAt: now,
  };
  const project: TProject = {
    metadata: {
      id: "proj-1",
      name: bp.metadata.title,
      duration: bp.metadata.duration,
      createdAt: now,
      updatedAt: now,
    },
    scenes: [scene],
    currentSceneId: scene.id,
    settings: {
      fps: bp.settings.fps,
      canvasSize: { width: bp.settings.width, height: bp.settings.height },
      background: { type: "color", color: "#000000" },
    },
    version: 1,
  };
  return { project, assets: buildMediaAssets(bp) };
}
