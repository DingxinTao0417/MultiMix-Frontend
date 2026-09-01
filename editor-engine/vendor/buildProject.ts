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
export type BackendTransform = {
  scaleX: number;
  scaleY: number;
  position: { x: number; y: number };
  rotate: number;
};
export interface BackendPresentationSupport {
  headline: string;
  items: string[];
}
export interface BackendEditDecision {
  layout?: string;
  motion?: string;
  transition?: string;
  presentation_support?: BackendPresentationSupport;
  [key: string]: unknown;
}
export interface BackendTransition {
  type: string;
  duration: number;
}

/**
 * Renderer-owned primitives registered by the backend's Presenter visual
 * system.  The director can choose a named style pack, but it never sends
 * arbitrary CSS through to the editor.
 */
export interface BackendPresenterVisualSystem {
  stylePackRef: string;
  motionIntensity: string;
}

export interface BackendPresenterNativeRender {
  schema_version: "presenter-native-event-render:v1";
  surface: "outline" | "panel" | "accent_band";
  border_width: number;
  surface_opacity: number;
  accent_opacity: number;
  motion_seconds: number;
  motion_treatment: "inherit" | "accent" | "support" | "takeover";
  foreground_color: string;
  surface_color: string;
  accent_color: string;
}

export interface BackendPresenterReframeExecution {
  schema_version: "presenter-reframe-execution:v1";
  transform: BackendTransform;
  entrance_seconds: number;
  exit_seconds: number;
}

/**
 * Track-owned events do not have a timeline element of their own.  Reframe
 * events are projected onto the retained source video when the editor builds
 * its animation channels, while this exact backend contract remains the
 * persistence source of truth.
 */
export interface BackendPresenterTrackEvent {
  eventId: string;
  eventType: string;
  startTime: number;
  duration: number;
  presenterReframe?: BackendPresenterReframeExecution;
  [key: string]: unknown;
}

export interface BackendElement {
  id: string;
  type: "video" | "image" | "audio" | "text";
  name?: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  retime?: { rate: number; maintainPitch?: boolean };
  mediaId?: string;
  content?: string;
  fontSize?: number;
  transform?: BackendTransform;
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
  textRole?:
    | "subtitle"
    | "presentation_support"
    | "brand_cta"
    | "presenter_emphasis"
    | "presenter_graphic";
  eventId?: string;
  eventType?: string;
  presenterSceneId?: string;
  enter?: string;
  exit?: string;
  requiredForPublish?: boolean;
  specHash?: string;
  compositionId?: string;
  motionTreatment?: string;
  presenterVisualSystem?: BackendPresenterVisualSystem;
  presenterNativeRender?: BackendPresenterNativeRender;
  presenterReframe?: BackendPresenterReframeExecution;
  assetId?: string | number;
  fullFrame?: boolean;
  subtitlePresentation?: "static_phrase" | "word_highlight" | "karaoke";
  subtitleTokens?: Array<{ text: string; startOffset: number; endOffset: number }>;
  subtitleBackground?: { enabled: boolean; color: string };
  subtitleStyle?: {
    fontFamily: string;
    color: string;
    accentColor: string;
    fontWeight: "normal" | "bold";
    maxLineChars: number;
    sizeScale: number;
    karaokeScale: number;
  };
}
export interface BackendTrack {
  id: string;
  type: "video" | "audio" | "text";
  name: string;
  elements: BackendElement[];
  overlay?: boolean;    // MG overlay track: composited above the main video, isMain=false
  logicalLayer?: string;
  presenterEvents?: BackendPresenterTrackEvent[];
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
  bgEnabled: false,
  bgColor: "#111827b8",
  maxLineChars: 24,
  sizeScale: 0.7,
  bottomOffset: 0.35,
};

const DEFAULT_SUBTITLE_SIZE_SCALE = defaultSubtitleStyle.sizeScale;
const LANDSCAPE_SUBTITLE_REGION: SafeRegion = {
  x: 0.08,
  y: 0.76,
  width: 0.84,
  height: 0.18,
};
const PORTRAIT_SUBTITLE_REGION: SafeRegion = {
  x: 0.08,
  y: 0.74,
  width: 0.84,
  height: 0.22,
};
const SQUARE_SUBTITLE_REGION: SafeRegion = {
  x: 0.08,
  y: 0.74,
  width: 0.84,
  height: 0.20,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function subtitleTypographyForCanvas(
  width: number,
  height: number,
  sizeScale: number,
): { preferredFontPx: number; minimumFontPx: number } {
  const portrait = height > width;
  const shortSide = Math.max(1, Math.min(width, height));
  const baseFontPx = portrait
    ? clamp(shortSide * 0.044, 44, 50)
    : clamp(shortSide * 0.046, 46, 54);
  const scale = Math.max(0.1, sizeScale) / DEFAULT_SUBTITLE_SIZE_SCALE;
  const preferredFontPx = baseFontPx * scale;
  const minimumFloor = portrait ? 40 : 42;
  return {
    preferredFontPx,
    minimumFontPx: Math.min(
      preferredFontPx,
      Math.max(minimumFloor, preferredFontPx * 0.82),
    ),
  };
}

export function subtitlePositionOffset(
  canvasHeight: number,
  safeRegion: SafeRegion,
  requestedBottomOffset: number,
): number {
  const requestedCenter = 0.5 + requestedBottomOffset;
  const safeTop = clamp(safeRegion.y, 0, 1);
  const safeBottom = clamp(safeRegion.y + safeRegion.height, safeTop, 1);
  const centre = clamp(requestedCenter, safeTop, safeBottom);
  return Math.round(canvasHeight * (centre - 0.5));
}

function defaultSubtitleRegion(width: number, height: number): SafeRegion {
  if (width === height) return SQUARE_SUBTITLE_REGION;
  return height > width
    ? PORTRAIT_SUBTITLE_REGION
    : LANDSCAPE_SUBTITLE_REGION;
}

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
  maxLineChars?: number;
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

function bestTwoLineSplit(
  text: string,
  fontPx: number,
  measure: CaptionMeasure,
  maxLineChars?: number,
): string | null {
  const tokens = captionTokens(text);
  if (tokens.length < 2) return null;
  let best: { text: string; widest: number } | null = null;
  for (let index = 1; index < tokens.length; index += 1) {
    const left = tokens.slice(0, index).join("").trim();
    const right = tokens.slice(index).join("").trim();
    if (!left || !right) continue;
    if (
      maxLineChars
      && (Array.from(left).length > maxLineChars || Array.from(right).length > maxLineChars)
    ) continue;
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

  const exceedsLineBudget = Boolean(
    options.maxLineChars && Array.from(compact).length > options.maxLineChars,
  );
  const preferredWidth = measure(compact, preferred);
  if (!exceedsLineBudget && preferredWidth <= options.availableWidth) {
    return { text: compact, lines: 1, fontPx: preferred };
  }
  const fitted = Math.max(minimum, preferred * options.availableWidth / preferredWidth);
  if (!exceedsLineBudget && measure(compact, fitted) <= options.availableWidth) {
    return { text: compact, lines: 1, fontPx: fitted };
  }
  const split = bestTwoLineSplit(compact, minimum, measure, options.maxLineChars);
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
export const presenterEventByElementId: Record<string, {
  eventId: string;
  eventType?: string;
  presenterSceneId?: string;
  compositionId?: string;
  motionTreatment?: string;
  presenterVisualSystem?: BackendPresenterVisualSystem;
  presenterNativeRender?: BackendPresenterNativeRender;
  assetId?: string | number;
  fullFrame?: boolean;
  enter?: string;
  exit?: string;
  requiredForPublish: boolean;
  specHash?: string;
}> = {};
// Reframe is a track-owned execution contract.  Keep it separate from the
// derived OpenCut keyframes so loading and saving never turns a renderer
// projection into the persistence source of truth.
export const presenterEventsByTrackId: Record<string, BackendPresenterTrackEvent[]> = {};
export const derivedPresenterReframeByElementId: Record<string, true> = {};
export const logicalLayerByTrackId: Record<string, string> = {};

// Timeline split keeps the left clip id but assigns a new id to the right
// clip. The OpenCut element type cannot carry our backend-only persistence
// fields, so copy every element-keyed field before serializing the split.
export function copyElementPersistenceMetadata(
  sourceElementId: string,
  targetElementIds: Iterable<string>,
): void {
  const targets = [...new Set(targetElementIds)].filter((id) => id && id !== sourceElementId);
  if (!targets.length) return;

  const copy = <T,>(map: Record<string, T>) => {
    const value = map[sourceElementId];
    if (value === undefined) return;
    for (const targetId of targets) map[targetId] = value;
  };

  copy(segmentIdByElementId);
  copy(segmentTextByElementId);
  copy(safeRegionByElementId);
  copy(displayTextByElementId);
  copy(focusTextByElementId);
  copy(editDecisionByElementId);
  copy(textRoleByElementId);
  copy(presenterEventByElementId);
  copy(derivedPresenterReframeByElementId);
}

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
    textRole: element.textRole,
  };
}

function numberMotionChannel(
  id: string,
  duration: number,
  start: number,
  end: number,
) {
  return {
    valueKind: "number" as const,
    keyframes: [
      { id: `${id}-start`, time: 0, value: start, interpolation: "linear" as const },
      { id: `${id}-end`, time: duration, value: end, interpolation: "linear" as const },
    ],
  };
}

function vectorMotionChannel(
  id: string,
  duration: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return {
    valueKind: "vector" as const,
    keyframes: [
      { id: `${id}-start`, time: 0, value: start, interpolation: "linear" as const },
      { id: `${id}-end`, time: duration, value: end, interpolation: "linear" as const },
    ],
  };
}

const PRESENTER_HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

function presenterNativeRenderForElement(
  element: BackendElement,
): BackendPresenterNativeRender | undefined {
  const render = element.presenterNativeRender;
  if (!render || render.schema_version !== "presenter-native-event-render:v1") return undefined;
  if (!(["outline", "panel", "accent_band"] as const).includes(render.surface)) {
    return undefined;
  }
  if (!(["inherit", "accent", "support", "takeover"] as const)
    .includes(render.motion_treatment)) {
    return undefined;
  }
  if (
    !Number.isFinite(render.border_width)
    || !Number.isFinite(render.surface_opacity)
    || !Number.isFinite(render.accent_opacity)
    || !Number.isFinite(render.motion_seconds)
    || render.border_width < 0
    || render.surface_opacity < 0
    || render.surface_opacity > 1
    || render.accent_opacity < 0
    || render.accent_opacity > 1
    || render.motion_seconds <= 0
    || render.motion_seconds > 0.5
    || !PRESENTER_HEX_COLOR.test(render.foreground_color)
    || !PRESENTER_HEX_COLOR.test(render.surface_color)
    || !PRESENTER_HEX_COLOR.test(render.accent_color)
  ) {
    return undefined;
  }
  return render;
}

function hexWithOpacity(hex: string, opacity: number): string {
  const alpha = Math.round(clamp(opacity, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${hex}${alpha}`;
}

function presenterMotionOffsets(
  treatment: BackendPresenterNativeRender["motion_treatment"] | undefined,
): { entrance: number; exit: number } {
  switch (treatment) {
    case "accent":
      return { entrance: 16, exit: 8 };
    case "support":
      return { entrance: 10, exit: 5 };
    case "takeover":
      return { entrance: 6, exit: 3 };
    default:
      return { entrance: 12, exit: 6 };
  }
}

function presenterEventAnimations(
  element: BackendElement,
  position: { x: number; y: number },
): ElementAnimations | undefined {
  if (element.animations) return element.animations;
  const duration = element.duration;
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const hasEntrance = element.enter !== "cut";
  const hasExit = element.exit !== "cut";
  if (!hasEntrance && !hasExit) return undefined;
  const nativeRender = presenterNativeRenderForElement(element);
  const motionSeconds = nativeRender?.motion_seconds ?? 0.22;
  const entranceEnd = Math.min(motionSeconds, duration * 0.18);
  const exitStart = Math.max(
    entranceEnd,
    duration - Math.min(motionSeconds, duration * 0.18),
  );
  const offsets = presenterMotionOffsets(nativeRender?.motion_treatment);
  const opacityKeyframes = [
    { id: `${element.id}-opacity-start`, time: 0, value: hasEntrance ? 0 : 1, interpolation: "linear" as const },
    { id: `${element.id}-opacity-in`, time: entranceEnd, value: 1, interpolation: "linear" as const },
    { id: `${element.id}-opacity-out`, time: exitStart, value: 1, interpolation: "linear" as const },
    { id: `${element.id}-opacity-end`, time: duration, value: hasExit ? 0 : 1, interpolation: "linear" as const },
  ];
  const positionKeyframes = [
    {
      id: `${element.id}-position-start`,
      time: 0,
      value: {
        x: position.x,
        y: position.y + (hasEntrance ? offsets.entrance : 0),
      },
      interpolation: "linear" as const,
    },
    {
      id: `${element.id}-position-in`,
      time: entranceEnd,
      value: position,
      interpolation: "linear" as const,
    },
    {
      id: `${element.id}-position-out`,
      time: exitStart,
      value: position,
      interpolation: "linear" as const,
    },
    {
      id: `${element.id}-position-end`,
      time: duration,
      value: {
        x: position.x,
        y: position.y - (hasExit ? offsets.exit : 0),
      },
      interpolation: "linear" as const,
    },
  ];
  return {
    channels: {
      opacity: { valueKind: "number", keyframes: opacityKeyframes },
      "transform.position": { valueKind: "vector", keyframes: positionKeyframes },
    },
  };
}

function wrapPresenterEventLine(
  text: string,
  fontPx: number,
  availableWidth: number,
  measure: CaptionMeasure,
): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length <= 1) return wrapMeasuredLine(text, fontPx, availableWidth, measure);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, fontPx) > availableWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => (
    measure(line, fontPx) <= availableWidth
      ? [line]
      : wrapMeasuredLine(line, fontPx, availableWidth, measure)
  ));
}

function layoutPresenterEventText(
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
  const lineHeight = options.lineHeight ?? 1.3;
  let fallback: SupportCardLayout | null = null;
  for (let fontPx = Math.floor(preferred); fontPx >= Math.ceil(minimum); fontPx -= 1) {
    const visualLines = sourceLines.flatMap((line) =>
      wrapPresenterEventLine(line, fontPx, options.availableWidth, measure)
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
  return fallback ?? { text: sourceLines.join("\n"), lines: sourceLines.length, fontPx: minimum };
}

function presenterEventTextElement(
  element: BackendElement,
  settings: BackendProject["settings"],
): TextElement {
  const region = element.safeRegion ?? { x: 0.08, y: 0.12, width: 0.32, height: 0.24 };
  const graphic = element.textRole === "presenter_graphic";
  const nativeRender = presenterNativeRenderForElement(element);
  const paddingX = Math.max(10, Math.round(settings.width * 0.012));
  const paddingY = Math.max(8, Math.round(settings.height * 0.012));
  const preferredFontPx = Math.min(
    graphic ? 30 : 32,
    Math.max(graphic ? 19 : 20, settings.height * (graphic ? 0.042 : 0.044)),
  );
  const minimumFontPx = Math.max(14, preferredFontPx * 0.7);
  const layout = layoutPresenterEventText((element.content || "").trim(), {
    availableWidth: Math.max(1, settings.width * region.width - paddingX * 2),
    availableHeight: Math.max(1, settings.height * region.height - paddingY * 2),
    preferredFontPx,
    minimumFontPx,
    fontFamily: subtitleStyle.fontFamily,
    lineHeight: graphic ? 1.3 : 1.24,
  });
  const position = {
    x: Math.round(settings.width * (region.x + region.width / 2 - 0.5)),
    y: Math.round(settings.height * (region.y + region.height / 2 - 0.5)),
  };
  return {
    id: element.id,
    name: element.name || (graphic ? "口播图形" : "口播重点"),
    type: "text",
    content: layout.text,
    duration: element.duration,
    startTime: element.startTime,
    trimStart: element.trimStart ?? 0,
    trimEnd: element.trimEnd ?? 0,
    fontSize: Math.max(2, (layout.fontPx * 90) / settings.height),
    fontFamily: subtitleStyle.fontFamily,
    color: nativeRender?.foreground_color ?? "#ffffff",
    background: {
      enabled: true,
      color: nativeRender
        ? hexWithOpacity(
            nativeRender.surface === "accent_band"
              ? nativeRender.accent_color
              : nativeRender.surface_color,
            nativeRender.surface === "accent_band"
              ? nativeRender.accent_opacity
              : nativeRender.surface_opacity,
          )
        : graphic ? "#171b26ee" : "#111827cc",
      cornerRadius: nativeRender
        ? 12 + Math.round(nativeRender.border_width)
        : graphic ? 16 : 12,
      paddingX,
      paddingY,
    },
    textAlign: "left",
    fontWeight: "bold",
    fontStyle: "normal",
    textDecoration: "none",
    lineHeight: graphic ? 1.3 : 1.24,
    transform: { ...IDENTITY_TRANSFORM, position },
    opacity: 1,
    animations: presenterEventAnimations(element, position),
    textRole: element.textRole,
  };
}

function imageMotionForDecision(
  elementId: string,
  decision: BackendEditDecision | undefined,
  duration: number,
  canvasWidth: number,
): ElementAnimations | undefined {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  switch (decision?.motion) {
    case "pan":
      return {
        channels: {
          "transform.position": {
            valueKind: "vector",
            keyframes: [
              {
                id: `${elementId}-pan-start`,
                time: 0,
                value: { x: -Math.round(canvasWidth * 0.025), y: 0 },
                interpolation: "linear",
              },
              {
                id: `${elementId}-pan-end`,
                time: duration,
                value: { x: Math.round(canvasWidth * 0.025), y: 0 },
                interpolation: "linear",
              },
            ],
          },
          "transform.scaleX": numberMotionChannel(`${elementId}-pan-x`, duration, 1.06, 1.06),
          "transform.scaleY": numberMotionChannel(`${elementId}-pan-y`, duration, 1.06, 1.06),
        },
      };
    case "slow_push":
      return {
        channels: {
          "transform.scaleX": numberMotionChannel(`${elementId}-push-x`, duration, 1, 1.06),
          "transform.scaleY": numberMotionChannel(`${elementId}-push-y`, duration, 1, 1.06),
        },
      };
    case "zoom":
    case "zoom_in":
      return {
        channels: {
          "transform.scaleX": numberMotionChannel(`${elementId}-zoom-x`, duration, 1, 1.1),
          "transform.scaleY": numberMotionChannel(`${elementId}-zoom-y`, duration, 1, 1.1),
        },
      };
    case "zoom_out":
      return { channels: {
        "transform.scaleX": numberMotionChannel(`${elementId}-zoom-out-x`, duration, 1.1, 1),
        "transform.scaleY": numberMotionChannel(`${elementId}-zoom-out-y`, duration, 1.1, 1),
      } };
    case "pan_left":
    case "pan_right": {
      const offset = Math.round(canvasWidth * 0.035);
      const leftward = decision.motion === "pan_left";
      return { channels: {
        "transform.position": vectorMotionChannel(`${elementId}-${decision.motion}`, duration, { x: leftward ? offset : -offset, y: 0 }, { x: leftward ? -offset : offset, y: 0 }),
        "transform.scaleX": numberMotionChannel(`${elementId}-pan-direction-x`, duration, 1.08, 1.08),
        "transform.scaleY": numberMotionChannel(`${elementId}-pan-direction-y`, duration, 1.08, 1.08),
      } };
    }
    case "drift_up":
    case "drift_down": {
      const offset = Math.round(canvasWidth * 0.025);
      const upward = decision.motion === "drift_up";
      return { channels: {
        "transform.position": vectorMotionChannel(`${elementId}-${decision.motion}`, duration, { x: 0, y: upward ? offset : -offset }, { x: 0, y: upward ? -offset : offset }),
        "transform.scaleX": numberMotionChannel(`${elementId}-drift-x`, duration, 1.06, 1.06),
        "transform.scaleY": numberMotionChannel(`${elementId}-drift-y`, duration, 1.06, 1.06),
      } };
    }
    case "ken_burns":
      return { channels: {
        "transform.position": vectorMotionChannel(`${elementId}-ken-burns`, duration, { x: -Math.round(canvasWidth * 0.025), y: Math.round(canvasWidth * 0.015) }, { x: Math.round(canvasWidth * 0.025), y: -Math.round(canvasWidth * 0.015) }),
        "transform.scaleX": numberMotionChannel(`${elementId}-ken-burns-x`, duration, 1.02, 1.1),
        "transform.scaleY": numberMotionChannel(`${elementId}-ken-burns-y`, duration, 1.02, 1.1),
      } };
    case "parallax":
      return { channels: {
        "transform.position": vectorMotionChannel(`${elementId}-parallax`, duration, { x: -Math.round(canvasWidth * 0.018), y: Math.round(canvasWidth * 0.012) }, { x: Math.round(canvasWidth * 0.018), y: -Math.round(canvasWidth * 0.012) }),
        "transform.scaleX": numberMotionChannel(`${elementId}-parallax-x`, duration, 1.08, 1.04),
        "transform.scaleY": numberMotionChannel(`${elementId}-parallax-y`, duration, 1.08, 1.04),
      } };
    default:
      return undefined;
  }
}

function brandCtaTextElement(
  element: BackendElement,
  settings: BackendProject["settings"],
): TextElement {
  const region = element.safeRegion ?? {
    x: 0.14,
    y: 0.18,
    width: 0.72,
    height: 0.30,
  };
  const preferredFontPx = Math.min(56, Math.max(34, settings.height * 0.052));
  const minimumFontPx = Math.max(28, preferredFontPx * 0.7);
  const layout = layoutCaption(element.content || "", {
    availableWidth: settings.width * region.width,
    preferredFontPx,
    minimumFontPx,
    fontFamily: subtitleStyle.fontFamily,
    maxLineChars: 16,
  });
  return {
    id: element.id,
    name: element.name || "品牌引导",
    type: "text",
    content: layout.text,
    duration: element.duration,
    startTime: element.startTime,
    trimStart: element.trimStart ?? 0,
    trimEnd: element.trimEnd ?? 0,
    fontSize: Math.max(2, (layout.fontPx * 90) / settings.height),
    fontFamily: subtitleStyle.fontFamily,
    color: "#ffffff",
    background: {
      enabled: true,
      color: "#101828cc",
      cornerRadius: 14,
      paddingX: Math.round(settings.width * 0.018),
      paddingY: Math.round(settings.height * 0.012),
    },
    textAlign: "center",
    fontWeight: "bold",
    fontStyle: "normal",
    textDecoration: "none",
    lineHeight: 1.28,
    transform: {
      ...IDENTITY_TRANSFORM,
      position: {
        x: 0,
        y: subtitlePositionOffset(settings.height, region, 0),
      },
    },
    opacity: 1,
    textRole: "brand_cta",
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

function clonePresenterTrackEvents(
  events: BackendPresenterTrackEvent[],
): BackendPresenterTrackEvent[] {
  return events.map((event) => ({
    ...event,
    ...(event.presenterReframe
      ? {
          presenterReframe: {
            ...event.presenterReframe,
            transform: {
              ...event.presenterReframe.transform,
              position: { ...event.presenterReframe.transform.position },
            },
          },
        }
      : {}),
  }));
}

function validReframeTransform(
  transform: BackendTransform | undefined,
): transform is BackendTransform {
  return Boolean(
    transform
    && Number.isFinite(transform.scaleX)
    && Number.isFinite(transform.scaleY)
    && Number.isFinite(transform.position?.x)
    && Number.isFinite(transform.position?.y)
    && Number.isFinite(transform.rotate),
  );
}

function presenterReframeAnimationsForElement(
  element: BackendElement,
  presenterEvents: BackendPresenterTrackEvent[] | undefined,
  baseTransform: BackendTransform,
): ElementAnimations | undefined {
  if (!presenterEvents?.length || !Number.isFinite(element.duration) || element.duration <= 0) {
    return undefined;
  }
  const elementStart = element.startTime;
  const elementEnd = elementStart + element.duration;
  const reframeEvents = presenterEvents
    .filter((event) => {
      const reframe = event.eventType === "presenter_reframe"
        ? event.presenterReframe
        : undefined;
      return Boolean(
        reframe
        && reframe.schema_version === "presenter-reframe-execution:v1"
        && Number.isFinite(event.startTime)
        && Number.isFinite(event.duration)
        && event.duration > 0
        && Number.isFinite(reframe.entrance_seconds)
        && Number.isFinite(reframe.exit_seconds)
        && reframe.entrance_seconds >= 0
        && reframe.exit_seconds >= 0
        && validReframeTransform(reframe.transform)
        && event.startTime < elementEnd
        && event.startTime + event.duration > elementStart,
      );
    })
    .sort((left, right) => left.startTime - right.startTime);
  if (!reframeEvents.length) return undefined;

  const positionKeyframes: Array<{
    id: string;
    time: number;
    value: { x: number; y: number };
    interpolation: "linear";
  }> = [];
  const scaleXKeyframes: Array<{
    id: string;
    time: number;
    value: number;
    interpolation: "linear";
  }> = [];
  const scaleYKeyframes: Array<{
    id: string;
    time: number;
    value: number;
    interpolation: "linear";
  }> = [];
  const addKeyframe = (
    eventId: string,
    phase: string,
    time: number,
    transform: BackendTransform,
  ) => {
    positionKeyframes.push({
      id: `${element.id}-${eventId}-position-${phase}`,
      time,
      value: { ...transform.position },
      interpolation: "linear",
    });
    scaleXKeyframes.push({
      id: `${element.id}-${eventId}-scale-x-${phase}`,
      time,
      value: transform.scaleX,
      interpolation: "linear",
    });
    scaleYKeyframes.push({
      id: `${element.id}-${eventId}-scale-y-${phase}`,
      time,
      value: transform.scaleY,
      interpolation: "linear",
    });
  };

  for (const event of reframeEvents) {
    const reframe = event.presenterReframe!;
    const eventStart = clamp(event.startTime - elementStart, 0, element.duration);
    const eventEnd = clamp(
      event.startTime + event.duration - elementStart,
      eventStart,
      element.duration,
    );
    if (eventEnd <= eventStart) continue;
    const entranceEnd = Math.min(
      eventEnd,
      eventStart + Math.min(reframe.entrance_seconds, event.duration * 0.18),
    );
    const exitStart = Math.max(
      entranceEnd,
      eventEnd - Math.min(reframe.exit_seconds, event.duration * 0.18),
    );
    addKeyframe(event.eventId, "before", eventStart, baseTransform);
    addKeyframe(event.eventId, "in", entranceEnd, reframe.transform);
    addKeyframe(event.eventId, "out", exitStart, reframe.transform);
    addKeyframe(event.eventId, "after", eventEnd, baseTransform);
  }

  if (!positionKeyframes.length) return undefined;
  return {
    channels: {
      "transform.position": {
        valueKind: "vector",
        keyframes: positionKeyframes,
      },
      "transform.scaleX": {
        valueKind: "number",
        keyframes: scaleXKeyframes,
      },
      "transform.scaleY": {
        valueKind: "number",
        keyframes: scaleYKeyframes,
      },
    },
  };
}

function buildTracks(bp: BackendProject): TimelineTrack[] {
  const tracks: TimelineTrack[] = [];
  const segmentWindows = buildSegmentWindows(bp.tracks);

  for (const t of bp.tracks) {
    if (t.logicalLayer) logicalLayerByTrackId[t.id] = t.logicalLayer;
    if (t.presenterEvents?.length) {
      presenterEventsByTrackId[t.id] = clonePresenterTrackEvents(t.presenterEvents);
    }
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
      if (e.eventId) {
        presenterEventByElementId[e.id] = {
          eventId: e.eventId,
          ...(e.eventType ? { eventType: e.eventType } : {}),
          ...(e.presenterSceneId ? { presenterSceneId: e.presenterSceneId } : {}),
          ...(e.compositionId ? { compositionId: e.compositionId } : {}),
          ...(e.motionTreatment ? { motionTreatment: e.motionTreatment } : {}),
          ...(e.presenterVisualSystem
            ? { presenterVisualSystem: { ...e.presenterVisualSystem } }
            : {}),
          ...(e.presenterNativeRender
            ? { presenterNativeRender: { ...e.presenterNativeRender } }
            : {}),
          ...(e.assetId !== undefined ? { assetId: e.assetId } : {}),
          ...(e.fullFrame === true ? { fullFrame: true } : {}),
          ...(e.enter ? { enter: e.enter } : {}),
          ...(e.exit ? { exit: e.exit } : {}),
          requiredForPublish: e.requiredForPublish === true,
          ...(e.specHash ? { specHash: e.specHash } : {}),
        };
      }
    }
    if (t.type === "video") {
      const elements = sourceElements.map((e): VideoElement | ImageElement => {
        if (e.segmentText) segmentTextByElementId[e.id] = e.segmentText;
        const transition = transitionForElement(e);
        const transform = e.transform
          ? {
              ...e.transform,
              position: { ...e.transform.position },
            }
          : mediaTransformForDecision(e.editDecision, bp.settings.width);
        const base = {
          id: e.id,
          name: e.name || e.segmentText?.slice(0, 20) || "clip",
          duration: e.duration,
          startTime: e.startTime,
          trimStart: e.trimStart ?? 0,
          trimEnd: e.trimEnd ?? 0,
          transform,
          opacity: 1,
          ...(transition ? { transition } : {}),
        };
        if (e.type === "image") {
          const animations = e.animations ?? imageMotionForDecision(
            e.id,
            e.editDecision,
            e.duration,
            bp.settings.width,
          );
          return {
            ...base,
            type: "image",
            mediaId: e.mediaId || "",
            ...(animations ? { animations } : {}),
          } as ImageElement;
        }
        // Stock video clips carry their own voices/music. Narration lives on the
        // audio track, so mute the clip's source audio unless the backend
        // explicitly kept it (e.g. a user-provided clip meant to be heard).
        const animations = e.animations ?? presenterReframeAnimationsForElement(
          e,
          t.presenterEvents,
          transform,
        );
        if (animations && !e.animations) {
          derivedPresenterReframeByElementId[e.id] = true;
        }
        return {
          ...base,
          type: "video",
          mediaId: e.mediaId || "",
          muted: e.muted !== false,
          ...(animations ? { animations } : {}),
          ...(e.retime && Number.isFinite(e.retime.rate) && e.retime.rate > 0
            ? { retime: e.retime }
            : {}),
        } as VideoElement;
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
        ...(e.retime && Number.isFinite(e.retime.rate) && e.retime.rate > 0
          ? { retime: e.retime }
          : {}),
      }));
      tracks.push({ id: t.id, name: t.name, type: "audio", elements, muted: false });
    } else if (t.type === "text") {
      // OpenCut renders text as scaledPx = fontSize * (canvasHeight / 90) and only
      // breaks lines on "\n" (no auto-wrap). So we pick a per-line char budget,
      // hard-wrap the sentence into lines, and size the font to that budget.
      const elements = sourceElements.map((e): TextElement => {
        if (e.textRole === "presenter_emphasis" || e.textRole === "presenter_graphic") {
          return presenterEventTextElement(e, bp.settings);
        }
        if (e.textRole === "presentation_support") {
          return supportCardTextElement(e, bp.settings);
        }
        if (e.textRole === "brand_cta") {
          return brandCtaTextElement(e, bp.settings);
        }
        const profile = e.textRole === "subtitle" ? e.subtitleStyle : undefined;
        const style: SubtitleStyle = profile
          ? {
              ...subtitleStyle,
              fontFamily: profile.fontFamily || subtitleStyle.fontFamily,
              color: profile.color || subtitleStyle.color,
              sizeScale: profile.sizeScale || subtitleStyle.sizeScale,
              maxLineChars: profile.maxLineChars || subtitleStyle.maxLineChars,
            }
          : subtitleStyle;
        const { preferredFontPx, minimumFontPx } = subtitleTypographyForCanvas(
          bp.settings.width,
          bp.settings.height,
          style.sizeScale,
        );
        const availableWidth = bp.settings.width * (e.safeRegion?.width ?? 0.84);
        const caption = layoutCaption(e.content || "", {
          availableWidth,
          preferredFontPx,
          minimumFontPx,
          fontFamily: style.fontFamily,
          maxLineChars: style.maxLineChars,
        });
        const positionY = subtitlePositionOffset(
          bp.settings.height,
          e.safeRegion ?? defaultSubtitleRegion(bp.settings.width, bp.settings.height),
          e.transform
            ? e.transform.position.y / bp.settings.height
            : style.bottomOffset,
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
        fontSize: (
          typeof e.fontSize === "number" && Number.isFinite(e.fontSize)
            ? e.fontSize
            : Math.max(0.5, (caption.fontPx * 90) / bp.settings.height)
        ),
        fontFamily: style.fontFamily,
        color: style.color,
        background: e.textRole === "subtitle" && e.subtitleBackground
          ? { enabled: e.subtitleBackground.enabled, color: e.subtitleBackground.color, cornerRadius: 6, paddingX: 12, paddingY: 6 }
          : style.bgEnabled
          ? { enabled: true, color: style.bgColor, cornerRadius: 6, paddingX: 12, paddingY: 6 }
          : { enabled: false, color: "#000000" },
        textAlign: "center",
        fontWeight: profile?.fontWeight ?? "bold",
        fontStyle: "normal",
        textDecoration: "none",
        transform: {
          ...(e.transform ?? IDENTITY_TRANSFORM),
          position: {
            x: e.transform?.position.x ?? 0,
            y: positionY,
          },
        },
        opacity: 1,
        textRole: e.textRole,
        ...(
          e.textRole === "subtitle" && e.subtitlePresentation
            ? {
                subtitlePresentation: {
                  mode: e.subtitlePresentation,
                  tokens: e.subtitleTokens ?? [],
                  ...(profile?.accentColor ? { accentColor: profile.accentColor } : {}),
                  ...(typeof profile?.karaokeScale === "number"
                    ? { karaokeScale: profile.karaokeScale }
                    : {}),
                },
              }
            : {}
        ),
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
    presenterEventByElementId,
    presenterEventsByTrackId,
    derivedPresenterReframeByElementId,
    logicalLayerByTrackId,
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
