// Pure helpers for the embed film-strip editor (spec §5.5, demo
// final/workspace-video.html). Kept free of EditorCore so they unit-test
// without booting the engine.

// Spec §5.5: single-segment trim range is 2–15 seconds.
export const MIN_CLIP_SECONDS = 2;
export const MAX_CLIP_SECONDS = 15;

export type TrimState = {
  trimStart: number;
  trimEnd: number;
  duration: number; // timeline occupancy of the element
  startTime: number;
};

// `duration` is the occupied timeline length. The trim values move the source
// window within the media; they are not extra time to subtract from the
// timeline. In particular, split clips carry a trim offset on one side while
// retaining their own visible timeline duration.
export function visibleDuration(el: { duration: number; trimStart?: number; trimEnd?: number }): number {
  return Math.max(0, el.duration);
}

// Apply a handle drag of `deltaSeconds` to one edge, clamped so the timeline
// occupancy stays within [MIN_CLIP_SECONDS, MAX_CLIP_SECONDS]. The source
// length is the current occupancy plus both source offsets; trims never extend
// beyond that source window. Returns the changed occupancy as well as the
// source offsets and the left-edge start shift.
export function applyEdgeTrim(
  state: TrimState,
  edge: "left" | "right",
  deltaSeconds: number,
): { trimStart: number; trimEnd: number; startTime: number; duration: number } {
  const sourceDuration = state.duration + state.trimStart + state.trimEnd;
  const minVisible = Math.min(MIN_CLIP_SECONDS, sourceDuration);
  const clampDuration = (value: number, maxVisible: number) => (
    Math.max(minVisible, Math.min(maxVisible, value))
  );
  if (edge === "left") {
    // Dragging right (+delta) shrinks from the head; dragging left restores
    // previously trimmed material.
    const duration = clampDuration(
      state.duration - deltaSeconds,
      Math.min(MAX_CLIP_SECONDS, sourceDuration - state.trimEnd),
    );
    const appliedDelta = state.duration - duration;
    const trimStart = state.trimStart + appliedDelta;
    return {
      trimStart,
      trimEnd: state.trimEnd,
      startTime: state.startTime + appliedDelta,
      duration,
    };
  }
  // Right edge: dragging left (-delta) shrinks from the tail.
  const duration = clampDuration(
    state.duration + deltaSeconds,
    Math.min(MAX_CLIP_SECONDS, sourceDuration - state.trimStart),
  );
  const appliedDelta = duration - state.duration;
  return {
    trimStart: state.trimStart,
    trimEnd: state.trimEnd - appliedDelta,
    startTime: state.startTime,
    duration,
  };
}

// mm:ss badge, e.g. 30.4 -> "00:30".
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const mm = String(Math.floor(whole / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Group主轨 clips into display segments: consecutive clips sharing a
// segmentId keep one segment number (splits stay within the segment).
export function segmentNumberByElementId(
  orderedElements: Array<{ id: string }>,
  segmentIdOf: (elementId: string) => string | undefined,
): Record<string, number> {
  const numbers: Record<string, number> = {};
  let current: string | undefined;
  let counter = 0;
  for (const el of orderedElements) {
    const segment = segmentIdOf(el.id);
    if (segment === undefined || segment !== current) {
      counter += 1;
      current = segment;
    }
    numbers[el.id] = counter;
  }
  return numbers;
}

// Resolve a backend preview value: absolute URLs pass through, storage refs
// go through the media proxy the editor already uses for project media.
export function previewSrc(value: string | null | undefined, proxy: (ref: string) => string): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  return proxy(trimmed);
}
