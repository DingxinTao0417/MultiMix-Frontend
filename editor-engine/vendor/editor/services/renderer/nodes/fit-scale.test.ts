import { describe, expect, it } from "vitest";

import { computeFitScale } from "./fit-scale";

describe("computeFitScale", () => {
  // Canvas 9:16 portrait (1080x1920).
  const RW = 1080;
  const RH = 1920;

  it("contain: 16:9 source scales to fit inside (letterboxed), never exceeds canvas", () => {
    const s = computeFitScale(RW, RH, 1920, 1080, "contain");
    // contain uses the smaller ratio so the whole source is visible.
    expect(s).toBeCloseTo(Math.min(RW / 1920, RH / 1080));
    // scaled dimensions do not exceed the canvas on the binding axis.
    expect(1920 * s).toBeLessThanOrEqual(RW + 0.5);
  });

  it("cover: 16:9 source scales to FILL the canvas (no letterbox)", () => {
    const s = computeFitScale(RW, RH, 1920, 1080, "cover");
    expect(s).toBeCloseTo(Math.max(RW / 1920, RH / 1080));
    // cover fills: both scaled dimensions are >= canvas (overflow gets clipped).
    expect(1920 * s).toBeGreaterThanOrEqual(RW - 0.5);
    expect(1080 * s).toBeGreaterThanOrEqual(RH - 0.5);
  });

  it("cover: a matching 9:16 source exactly fills with no crop", () => {
    const s = computeFitScale(RW, RH, 1080, 1920, "cover");
    expect(1080 * s).toBeCloseTo(RW);
    expect(1920 * s).toBeCloseTo(RH);
  });

  it("defaults to contain when fitMode is undefined (zero-regression)", () => {
    const s = computeFitScale(RW, RH, 1920, 1080, undefined);
    expect(s).toBeCloseTo(Math.min(RW / 1920, RH / 1080));
  });

  it("guards against zero/invalid source dimensions", () => {
    expect(computeFitScale(RW, RH, 0, 0, "cover")).toBe(1);
    expect(Number.isFinite(computeFitScale(RW, RH, -5, 10, "cover"))).toBe(true);
  });
});
