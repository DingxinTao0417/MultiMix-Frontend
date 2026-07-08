import { describe, expect, it } from "vitest";

import {
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  applyEdgeTrim,
  formatClock,
  previewSrc,
  segmentNumberByElementId,
  visibleDuration,
} from "../../editor/filmstrip-utils";

describe("visibleDuration", () => {
  it("subtracts both trims from the source duration", () => {
    expect(visibleDuration({ duration: 10, trimStart: 2, trimEnd: 3 })).toBe(5);
    expect(visibleDuration({ duration: 4 })).toBe(4);
  });

  it("never goes negative", () => {
    expect(visibleDuration({ duration: 3, trimStart: 2, trimEnd: 2 })).toBe(0);
  });
});

describe("applyEdgeTrim", () => {
  const base = { trimStart: 1, trimEnd: 1, duration: 12, startTime: 5 };

  it("right-edge drag left shrinks the tail and keeps startTime", () => {
    const next = applyEdgeTrim(base, "right", -2);
    expect(next.trimEnd).toBe(3);
    expect(next.trimStart).toBe(1);
    expect(next.startTime).toBe(5);
  });

  it("left-edge drag right shrinks the head and shifts startTime", () => {
    const next = applyEdgeTrim(base, "left", 2);
    expect(next.trimStart).toBe(3);
    expect(next.startTime).toBe(7);
  });

  it("clamps the visible length at the 2s spec minimum", () => {
    const next = applyEdgeTrim(base, "right", -30);
    expect(base.duration - next.trimStart - next.trimEnd).toBe(MIN_CLIP_SECONDS);
  });

  it("clamps restore drags at the 15s spec maximum and never below zero trim", () => {
    const wide = { trimStart: 0, trimEnd: 0, duration: 40, startTime: 0 };
    const next = applyEdgeTrim(wide, "right", 30);
    expect(next.trimEnd).toBe(wide.duration - MAX_CLIP_SECONDS);
    const restore = applyEdgeTrim({ ...base, trimEnd: 0 }, "right", 5);
    expect(restore.trimEnd).toBe(0);
  });
});

describe("formatClock", () => {
  it("renders mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(30.4)).toBe("00:30");
    expect(formatClock(75)).toBe("01:15");
  });
});

describe("segmentNumberByElementId", () => {
  it("keeps split clips inside one segment number", () => {
    const numbers = segmentNumberByElementId(
      [{ id: "a" }, { id: "a2" }, { id: "b" }],
      (id) => ({ a: "scene-1", a2: "scene-1", b: "scene-2" })[id],
    );
    expect(numbers).toEqual({ a: 1, a2: 1, b: 2 });
  });

  it("counts unmapped clips as their own segments", () => {
    const numbers = segmentNumberByElementId(
      [{ id: "a" }, { id: "x" }, { id: "y" }],
      (id) => (id === "a" ? "scene-1" : undefined),
    );
    expect(numbers.a).toBe(1);
    expect(numbers.x).toBe(2);
    expect(numbers.y).toBe(3);
  });
});

describe("previewSrc", () => {
  const proxy = (ref: string) => `/media?ref=${ref}`;

  it("passes absolute urls through and proxies storage refs", () => {
    expect(previewSrc("https://cdn.example/a.jpg", proxy)).toBe("https://cdn.example/a.jpg");
    expect(previewSrc("uploads/a.jpg", proxy)).toBe("/media?ref=uploads/a.jpg");
  });

  it("returns undefined for empty values", () => {
    expect(previewSrc("", proxy)).toBeUndefined();
    expect(previewSrc(null, proxy)).toBeUndefined();
  });
});
