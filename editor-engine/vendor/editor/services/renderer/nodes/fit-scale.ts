export type FitMode = "cover" | "contain";

/**
 * Base scale to fit a source of (sourceWidth x sourceHeight) into a
 * (rendererWidth x rendererHeight) canvas.
 *
 * - "contain" (default): min ratio — whole source visible, may letterbox.
 * - "cover": max ratio — source fills the canvas, overflow is clipped.
 *
 * Main-track visuals use "cover" so every clip fills the unified canvas and
 * segments never look like mixed aspect ratios; overlays (MG alpha) keep the
 * default "contain" so they are not cropped.
 */
export function computeFitScale(
  rendererWidth: number,
  rendererHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fitMode: FitMode | undefined,
): number {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return 1;
  }
  const wRatio = rendererWidth / sourceWidth;
  const hRatio = rendererHeight / sourceHeight;
  return fitMode === "cover" ? Math.max(wRatio, hRatio) : Math.min(wRatio, hRatio);
}
