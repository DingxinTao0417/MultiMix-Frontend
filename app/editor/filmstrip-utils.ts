// Pure helpers for the embed film-strip editor (spec §5.5, demo
// final/workspace-video.html). Kept free of EditorCore so they unit-test
// without booting the engine.

// Spec §5.5: single-segment trim range is 2–15 seconds.
export const MIN_CLIP_SECONDS = 2;
export const MAX_CLIP_SECONDS = 15;

export type TrimState = {
  trimStart: number;
  trimEnd: number;
  duration: number; // source duration of the element
  startTime: number;
};

// Visible (played) length of an element after trims.
export function visibleDuration(el: { duration: number; trimStart?: number; trimEnd?: number }): number {
  return Math.max(0, el.duration - (el.trimStart ?? 0) - (el.trimEnd ?? 0));
}

// Apply a handle drag of `deltaSeconds` to one edge, clamped so the visible
// length stays within [MIN_CLIP_SECONDS, MAX_CLIP_SECONDS] and trims never go
// negative (can't extend past the source material). Returns the next trim
// values plus the startTime shift a left-edge trim implies.
export function applyEdgeTrim(
  state: TrimState,
  edge: "left" | "right",
  deltaSeconds: number,
): { trimStart: number; trimEnd: number; startTime: number } {
  const maxVisible = Math.min(MAX_CLIP_SECONDS, state.duration);
  const minVisible = Math.min(MIN_CLIP_SECONDS, state.duration);
  if (edge === "left") {
    // Dragging right (+delta) shrinks from the head; dragging left restores
    // previously trimmed material.
    let next = state.trimStart + deltaSeconds;
    next = Math.max(0, next);
    next = Math.min(next, state.duration - state.trimEnd - minVisible);
    next = Math.max(next, state.duration - state.trimEnd - maxVisible);
    return {
      trimStart: next,
      trimEnd: state.trimEnd,
      startTime: state.startTime + (next - state.trimStart),
    };
  }
  // Right edge: dragging left (-delta) shrinks from the tail.
  let next = state.trimEnd - deltaSeconds;
  next = Math.max(0, next);
  next = Math.min(next, state.duration - state.trimStart - minVisible);
  next = Math.max(next, state.duration - state.trimStart - maxVisible);
  return { trimStart: state.trimStart, trimEnd: next, startTime: state.startTime };
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
