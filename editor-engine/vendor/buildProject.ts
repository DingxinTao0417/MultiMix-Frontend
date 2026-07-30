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
import type { ElementAnimations } from "@editor/lib/animation/types";
import {
  VOLUME_DB_MAX,
  VOLUME_DB_MIN,
} from "./editor/lib/timeline/audio-constants";
import { mediaUrl } from "./api";

// Backend shapes (loose; mirror backend/timeline.py + pipeline.py output).
export interface BackendMedia {
  id: string;
  type: "video" | "image" | "audio";
  file_path: string;
  playback_url?: string;
  name: string;
  hasAlpha?: boolean;   // MG overlay WebM carries a transparency channel
}
export type SafeRegion = { x: number; y: number; width: number; height: number };
export interface BackendPresentationSupport {
  headline: string;
  items: string[];
}
export interface BackendEditDecision {
  layout?: string;
  transition?: string;
  presentation_support?: BackendPresentationSupport;
  [key: string]: unknown;
}
export interface BackendTransition {
  type: string;
  duration: number;
}

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
  volume?: number;
  volumeUnit?: "db" | "linear";
  animations?: ElementAnimations;
  transition?: BackendTransition;
  editDecision?: BackendEditDecision;
  textRole?: "subtitle" | "presentation_support";
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
const DEFAULT_SCENE_TRANSITION_SECONDS = 0.5;
const EDITOR_TRANSITION_BY_SEMANTIC: Record<string, string> = {
  dissolve: "dissolve",
  push: "slide_right",
  wipe: "wipe_left",
};
const SUPPORTED_EDITOR_TRANSITIONS = new Set([
  "fade",
  "dissolve",
  "slide_left",
  "slide_right",
  "wipe_left",
]);
type SegmentWindow = { startTime: number; duration: number };

function normalizedTransitionDuration(
  requestedDuration: number,
  elementDuration: number,
): number | undefined {
  if (
    !Number.isFinite(requestedDuration)
    || requestedDuration <= 0
    || !Number.isFinite(elementDuration)
    || elementDuration <= 0
  ) return undefined;
  return Math.min(requestedDuration, DEFAULT_SCENE_TRANSITION_SECONDS, elementDuration / 2);
}

function transitionForDecision(
  decision: BackendEditDecision | undefined,
  elementDuration: number,
): { type: string; duration: number } | undefined {
  const semantic = decision?.transition;
  if (!semantic || semantic === "cut") return undefined;
  const type = EDITOR_TRANSITION_BY_SEMANTIC[semantic];
  const duration = normalizedTransitionDuration(
    DEFAULT_SCENE_TRANSITION_SECONDS,
    elementDuration,
  );
  if (!type || duration === undefined) return undefined;
  return {
    type,
    duration,
  };
}

function transitionForElement(
  element: BackendElement,
): { type: string; duration: number } | undefined {
  if (Object.prototype.hasOwnProperty.call(element, "transition")) {
    const saved = element.transition;
    if (!saved || !SUPPORTED_EDITOR_TRANSITIONS.has(saved.type)) return undefined;
    const duration = normalizedTransitionDuration(saved.duration, element.duration);
    return duration === undefined ? undefined : { type: saved.type, duration };
  }
  return transitionForDecision(element.editDecision, element.duration);
}

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
  // A compact carrier keeps the caption readable over light UI, dark footage,
  // and moving media without occupying a full-width subtitle band.
  bgEnabled: true,
  bgColor: "#111827b8",
  maxLineChars: 24,
  sizeScale: 0.7,
  bottomOffset: 0.29,
};

// Module-level current style (mutated by the style panel before re-building).
let subtitleStyle: SubtitleStyle = { ...defaultSubtitleStyle };
export function setSubtitleStyle(s: SubtitleStyle) { subtitleStyle = s; }
export function getSubtitleStyle(): SubtitleStyle { return subtitleStyle; }

type CaptionMeasure = (text: string, fontPx: number) => number;

export interface CaptionLayoutOptions {
  availableWidth: number;
  preferredFontPx: number;
  minimumFontPx: number;
  fontFamily?: string;
  measureText?: CaptionMeasure;
}

export interface CaptionLayout {
  text: string;
  lines: 0 | 1 | 2;
  fontPx: number;
}

export interface SupportCardLayoutOptions extends CaptionLayoutOptions {
  availableHeight: number;
  lineHeight?: number;
}

export interface SupportCardLayout {
  text: string;
  lines: number;
  fontPx: number;
}

function fallbackTextWidth(text: string, fontPx: number): number {
  return Array.from(text).reduce((width, character) => {
    if (/\s/u.test(character)) return width + fontPx * 0.32;
    if (/[\u0000-\u00ff]/u.test(character)) return width + fontPx * 0.58;
    return width + fontPx;
  }, 0);
}

function browserTextWidth(fontFamily: string): CaptionMeasure {
  let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      context = new OffscreenCanvas(1, 1).getContext("2d");
    } else if (typeof document !== "undefined") {
      context = document.createElement("canvas").getContext("2d");
    }
  } catch {
    context = null;
  }
  if (!context) return fallbackTextWidth;
  return (text, fontPx) => {
    context.font = `700 ${fontPx}px ${fontFamily}`;
    return context.measureText(text).width;
  };
}

function captionTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*|./gu) ?? [];
}

function bestTwoLineSplit(text: string, fontPx: number, measure: CaptionMeasure): string | null {
  const tokens = captionTokens(text);
  if (tokens.length < 2) return null;
  let best: { text: string; widest: number } | null = null;
  for (let index = 1; index < tokens.length; index += 1) {
    const left = tokens.slice(0, index).join("").trim();
    const right = tokens.slice(index).join("").trim();
    if (!left || !right) continue;
    const widest = Math.max(measure(left, fontPx), measure(right, fontPx));
    if (!best || widest < best.widest) best = { text: `${left}\n${right}`, widest };
  }
  return best?.text ?? null;
}

export function layoutCaption(text: string, options: CaptionLayoutOptions): CaptionLayout {
  const compact = (text || "").trim();
  if (!compact) return { text: "", lines: 0, fontPx: options.preferredFontPx };
  const preferred = Math.max(options.minimumFontPx, options.preferredFontPx);
  const minimum = Math.min(preferred, options.minimumFontPx);
  const measure = options.measureText ?? browserTextWidth(options.fontFamily ?? "sans-serif");
  const hardLines = compact.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (hardLines.length > 1) {
    const preserved = hardLines.slice(0, 2).join("\n");
    const widest = Math.max(...hardLines.slice(0, 2).map((line) => measure(line, preferred)));
    const fitted = Math.max(minimum, Math.min(preferred, preferred * options.availableWidth / Math.max(1, widest)));
    return { text: preserved, lines: Math.min(2, hardLines.length) as 1 | 2, fontPx: fitted };
  }

  const preferredWidth = measure(compact, preferred);
  if (preferredWidth <= options.availableWidth) {
    return { text: compact, lines: 1, fontPx: preferred };
  }
  const fitted = Math.max(minimum, preferred * options.availableWidth / preferredWidth);
  if (measure(compact, fitted) <= options.availableWidth) {
    return { text: compact, lines: 1, fontPx: fitted };
  }
  const split = bestTwoLineSplit(compact, minimum, measure);
  return { text: split ?? compact, lines: split ? 2 : 1, fontPx: minimum };
}

function wrapMeasuredLine(
  text: string,
  fontPx: number,
  availableWidth: number,
  measure: CaptionMeasure,
): string[] {
  const result: string[] = [];
  let current = "";
  for (const character of Array.from(text)) {
    const candidate = `${current}${character}`;
    if (current && measure(candidate, fontPx) > availableWidth) {
      result.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
}

export function layoutSupportCardText(
  text: string,
  options: SupportCardLayoutOptions,
): SupportCardLayout {
  const sourceLines = (text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!sourceLines.length) {
    return { text: "", lines: 0, fontPx: options.preferredFontPx };
  }
  const preferred = Math.max(options.minimumFontPx, options.preferredFontPx);
  const minimum = Math.min(preferred, options.minimumFontPx);
  const measure = options.measureText
    ?? browserTextWidth(options.fontFamily ?? "sans-serif");
  const lineHeight = options.lineHeight ?? 1.45;
  let fallback: SupportCardLayout | null = null;
  for (
    let fontPx = Math.floor(preferred);
    fontPx >= Math.ceil(minimum);
    fontPx -= 1
  ) {
    const visualLines = sourceLines.flatMap((line) =>
      wrapMeasuredLine(line, fontPx, options.availableWidth, measure)
    );
    const candidate = {
      text: visualLines.join("\n"),
      lines: visualLines.length,
      fontPx,
    };
    fallback = candidate;
    if (visualLines.length * fontPx * lineHeight <= options.availableHeight) {
      return candidate;
    }
  }
  return fallback ?? {
    text: sourceLines.join("\n"),
    lines: sourceLines.length,
    fontPx: minimum,
  };
}

// Side map: element id -> segment text (OpenCut element type has no such field).
// Used by the replace-material panel to re-search by the segment's script text.
export const segmentTextByElementId: Record<string, string> = {};

function linearGainToEditorDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return VOLUME_DB_MIN;
  return Math.min(VOLUME_DB_MAX, Math.max(VOLUME_DB_MIN, 20 * Math.log10(value)));
}

function audioAnimationsForEditor(
  animations: ElementAnimations | undefined,
  volumeUnit: BackendElement["volumeUnit"],
): ElementAnimations | undefined {
  if (!animations || volumeUnit !== "linear") return animations;
  const volume = animations.channels.volume;
  if (!volume || volume.valueKind !== "number") return animations;
  return {
    ...animations,
    channels: {
      ...animations.channels,
      volume: {
        ...volume,
        keyframes: volume.keyframes.map((keyframe) => ({
          ...keyframe,
          value: linearGainToEditorDb(keyframe.value),
        })),
      },
    },
  };
}

// Side maps for saving: OpenCut's types carry neither the backend file_path nor
// the segment id, but both must survive the save round-trip (media refs feed
// the media proxy; segment ids anchor MG overlays).
export const filePathByMediaId: Record<string, string> = {};
export const segmentIdByElementId: Record<string, string> = {};
export const safeRegionByElementId: Record<string, SafeRegion> = {};
export const displayTextByElementId: Record<string, string> = {};
export const focusTextByElementId: Record<string, string> = {};
export const editDecisionByElementId: Record<string, BackendEditDecision> = {};
export const textRoleByElementId: Record<string, NonNullable<BackendElement["textRole"]>> = {};

function validatedSplitSupport(
  decision: BackendEditDecision | undefined,
): BackendPresentationSupport | null {
  if (!decision || decision.layout !== "split") return null;
  const support = decision.presentation_support;
  if (!support || typeof support.headline !== "string" || !support.headline.trim()) {
    return null;
  }
  if (
    !Array.isArray(support.items)
    || support.items.length < 1
    || support.items.length > 3
    || support.items.some((item) => typeof item !== "string" || !item.trim())
  ) {
    return null;
  }
  return support;
}

function mediaTransformForDecision(
  decision: BackendEditDecision | undefined,
  canvasWidth: number,
) {
  if (!validatedSplitSupport(decision)) return { ...IDENTITY_TRANSFORM };
  if (
    decision?.presentation_canvas_version === "split_native_v1"
    || decision?.presentation_canvas_version === "split_native_v2"
  ) {
    return { ...IDENTITY_TRANSFORM };
  }
  return {
    scaleX: 0.62,
    scaleY: 0.62,
    position: { x: -Math.round(canvasWidth * 0.18), y: 0 },
    rotate: 0,
  };
}

export interface SupportCardPanelGeometry {
  availableWidth: number;
  availableHeight: number;
  paddingX: number;
  paddingY: number;
  position: { x: number; y: number };
}

const SPLIT_NATIVE_V2_SUPPORT_Y_OFFSET = 0.19;
const SPLIT_NATIVE_V2_SUBTITLE_Y_OFFSET = 0.4;

export function supportCardPanelGeometry(
  settings: BackendProject["settings"],
  canvasVersion: string | undefined,
): SupportCardPanelGeometry {
  const landscape = settings.width > settings.height;
  const nativePaddingX = Math.round(
    settings.width * (landscape ? 0.015 : 0.035),
  );
  const nativePaddingY = Math.round(
    settings.height * (landscape ? 0.045 : 0.025),
  );
  if (canvasVersion === "split_native_v2") {
    return {
      availableWidth: Math.round(settings.width * (landscape ? 0.82 : 0.78)),
      availableHeight: Math.round(settings.height * (landscape ? 0.18 : 0.25)),
      paddingX: nativePaddingX,
      paddingY: nativePaddingY,
      position: landscape
        ? {
            x: -Math.round(settings.width * 0.4),
            y: Math.round(
              settings.height * SPLIT_NATIVE_V2_SUPPORT_Y_OFFSET,
            ),
          }
        : {
            x: -Math.round(settings.width * 0.39),
            y: Math.round(
              settings.height * SPLIT_NATIVE_V2_SUPPORT_Y_OFFSET,
            ),
          },
    };
  }
  if (canvasVersion === "split_native_v1") {
    return {
      availableWidth: Math.round(settings.width * (landscape ? 0.27 : 0.78)),
      availableHeight: Math.round(settings.height * (landscape ? 0.54 : 0.3)),
      paddingX: nativePaddingX,
      paddingY: nativePaddingY,
      position: landscape
        ? { x: Math.round(settings.width * 0.15), y: 0 }
        : {
            x: -Math.round(settings.width * 0.39),
            y: Math.round(settings.height * 0.27),
          },
    };
  }
  return {
    availableWidth: Math.round(settings.width * 0.27),
    availableHeight: Math.round(settings.height * 0.54),
    paddingX: Math.round(settings.width * 0.015),
    paddingY: Math.round(settings.height * 0.08),
    position: { x: Math.round(settings.width * 0.17), y: 0 },
  };
}

function supportCardTextElement(
  element: BackendElement,
  settings: BackendProject["settings"],
): TextElement {
  const content = (element.content || "").trim();
  const preferredFontPx = Math.min(42, Math.max(30, settings.height * 0.038));
  const minimumFontPx = Math.min(preferredFontPx, Math.max(24, preferredFontPx * 0.72));
  const canvasVersion = (
    typeof element.editDecision?.presentation_canvas_version === "string"
      ? element.editDecision.presentation_canvas_version
      : undefined
  );
  const geometry = supportCardPanelGeometry(settings, canvasVersion);
  const layout = layoutSupportCardText(content, {
    availableWidth: geometry.availableWidth,
    availableHeight: geometry.availableHeight,
    preferredFontPx,
    minimumFontPx,
    fontFamily: subtitleStyle.fontFamily,
    lineHeight: 1.45,
  });
  return {
    id: element.id,
    name: element.name || "支撑信息",
    type: "text",
    content: layout.text,
    duration: element.duration,
    startTime: element.startTime,
    trimStart: element.trimStart ?? 0,
    trimEnd: element.trimEnd ?? 0,
    fontSize: Math.max(2, (layout.fontPx * 90) / settings.height),
    fontFamily: subtitleStyle.fontFamily,
    color: "#f8fafc",
    background: {
      enabled: true,
      color: "#171b26",
      cornerRadius: 18,
      paddingX: geometry.paddingX,
      paddingY: geometry.paddingY,
    },
    textAlign: "left",
    fontWeight: "bold",
    fontStyle: "normal",
    textDecoration: "none",
    lineHeight: 1.45,
    transform: {
      ...IDENTITY_TRANSFORM,
      position: geometry.position,
    },
    opacity: 1,
  };
}

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
  const splitNativeV2SupportSegmentIds = new Set(
    bp.tracks
      .flatMap((track) => track.elements)
      .filter(
        (element) =>
          element.segmentId
          && element.editDecision?.presentation_canvas_version === "split_native_v2"
          && validatedSplitSupport(element.editDecision),
      )
      .map((element) => element.segmentId as string),
  );

  for (const t of bp.tracks) {
    const sourceElements = t.overlay
      ? t.elements.map((element) => clampOverlayElementToSegment(element, segmentWindows))
      : t.elements;

    for (const e of sourceElements) {
      if (e.segmentId) segmentIdByElementId[e.id] = e.segmentId;
      if (e.safeRegion) safeRegionByElementId[e.id] = e.safeRegion;
      if (e.displayText) displayTextByElementId[e.id] = e.displayText;
      if (e.focusText) focusTextByElementId[e.id] = e.focusText;
      if (e.editDecision) editDecisionByElementId[e.id] = e.editDecision;
      if (e.textRole) textRoleByElementId[e.id] = e.textRole;
    }
    if (t.type === "video") {
      const elements = sourceElements.map((e): VideoElement | ImageElement => {
        if (e.segmentText) segmentTextByElementId[e.id] = e.segmentText;
        const transition = transitionForElement(e);
        const base = {
          id: e.id,
          name: e.name || e.segmentText?.slice(0, 20) || "clip",
          duration: e.duration,
          startTime: e.startTime,
          trimStart: e.trimStart ?? 0,
          trimEnd: e.trimEnd ?? 0,
          transform: mediaTransformForDecision(e.editDecision, bp.settings.width),
          opacity: 1,
          ...(transition ? { transition } : {}),
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
        volume: e.volumeUnit === "linear"
          ? linearGainToEditorDb(e.volume ?? 1)
          : (e.volume ?? 1),
        animations: audioAnimationsForEditor(e.animations, e.volumeUnit),
      }));
      tracks.push({ id: t.id, name: t.name, type: "audio", elements, muted: false });
    } else if (t.type === "text") {
      // OpenCut renders text as scaledPx = fontSize * (canvasHeight / 90) and only
      // breaks lines on "\n" (no auto-wrap). So we pick a per-line char budget,
      // hard-wrap the sentence into lines, and size the font to that budget.
      const style = subtitleStyle;
      const preferredFontPx = Math.min(56, Math.max(42, bp.settings.height * 0.05)) * style.sizeScale;
      const minimumFontPx = Math.min(preferredFontPx, Math.max(34, preferredFontPx * 0.78));
      const elements = sourceElements.map((e): TextElement => {
        if (e.textRole === "presentation_support") {
          return supportCardTextElement(e, bp.settings);
        }
        const availableWidth = bp.settings.width * (e.safeRegion?.width ?? 0.84);
        const caption = layoutCaption(e.content || "", {
          availableWidth,
          preferredFontPx,
          minimumFontPx,
          fontFamily: style.fontFamily,
        });
        const bottomOffset = (
          e.segmentId && splitNativeV2SupportSegmentIds.has(e.segmentId)
            ? SPLIT_NATIVE_V2_SUBTITLE_Y_OFFSET
            : style.bottomOffset
        );
        return ({
        id: e.id,
        name: e.name || "text",
        type: "text",
        content: caption.text,
        duration: e.duration,
        startTime: e.startTime,
        trimStart: e.trimStart ?? 0,
        trimEnd: e.trimEnd ?? 0,
        fontSize: Math.max(2, (caption.fontPx * 90) / bp.settings.height),
        fontFamily: style.fontFamily,
        color: style.color,
        background: style.bgEnabled
          ? { enabled: true, color: style.bgColor, cornerRadius: 6, paddingX: 12, paddingY: 6 }
          : { enabled: false, color: "#000000" },
        textAlign: "center",
        fontWeight: "bold",
        fontStyle: "normal",
        textDecoration: "none",
        transform: { ...IDENTITY_TRANSFORM, position: { x: 0, y: Math.round(bp.settings.height * bottomOffset) } },
        opacity: 1,
      });
      });
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
    editDecisionByElementId,
    textRoleByElementId,
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
