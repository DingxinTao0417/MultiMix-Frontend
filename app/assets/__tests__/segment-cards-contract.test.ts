import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const component = readFileSync(new URL("../components/segment-cards.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");

describe("storyboard segment-card interaction contract", () => {
  test("keeps cards selectable independently from an exported MP4", () => {
    expect(component).toContain("onSelect?: (segment: AssetProductSegment) => void");
    expect(component).toContain("const selectable = Boolean(onSelect)");
    expect(component).not.toContain("onSelect && segment.startSeconds != null");
    expect(component).toContain('role={selectable ? "button" : undefined}');
  });

  test("shows a replace-material action on hover, focus and active cards", () => {
    expect(component).toContain("onReplaceMaterial?: (segment: AssetProductSegment) => void");
    expect(component).toContain("shadcn-prototype-segment-actions");
    expect(component).toContain("换素材");
    expect(component).toContain("event.stopPropagation()");
    expect(css).toMatch(/\.shadcn-prototype-segment-cards li:(?:hover|focus-within)[^{]*\.shadcn-prototype-segment-actions/s);
    expect(css).toMatch(/\.shadcn-prototype-segment-cards li\.active \.shadcn-prototype-segment-actions/s);
  });

  test("renders the MG decision status alongside its template label", () => {
    expect(component).toContain("segment.mgStatus");
    expect(component).toContain("shadcn-prototype-segment-mg-status");
  });
});
