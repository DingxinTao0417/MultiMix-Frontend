import { describe, expect, it } from "vitest";

import {
  BRAND_SHOWCASE_SPEC_VERSION,
  brandShowcaseFilename,
  brandShowcasePlacement,
} from "../brand-showcase";

describe("brand showcase contract", () => {
  it("uses the approved version and 1080-short-edge placement", () => {
    expect(BRAND_SHOWCASE_SPEC_VERSION).toBe("multimix-brand-showcase:v1");
    expect(brandShowcasePlacement(1920, 1080)).toEqual({
      width: 160,
      right: 28,
      bottom: 28,
    });
    expect(brandShowcasePlacement(1080, 1920)).toEqual({
      width: 160,
      right: 28,
      bottom: 28,
    });
    expect(brandShowcasePlacement(1080, 1080)).toEqual({
      width: 160,
      right: 28,
      bottom: 28,
    });
  });

  it("adds the brand suffix without changing original filenames", () => {
    expect(brandShowcaseFilename("launch.mp4", "brand_showcase"))
      .toBe("launch-multimix-brand.mp4");
    expect(brandShowcaseFilename("launch.mp4", "original")).toBe("launch.mp4");
    expect(brandShowcaseFilename("launch", "brand_showcase"))
      .toBe("launch-multimix-brand");
  });
});
