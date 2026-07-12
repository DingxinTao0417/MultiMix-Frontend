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

  test("keeps the MG label compact and only surfaces a failed render state", () => {
    expect(component).toContain('segment.mgStatus === "failed"');
    expect(component).toContain("shadcn-prototype-segment-mg-status");
    expect(component).not.toContain("function mgStatusLabel");
  });

  test("keeps normal cards quiet and only labels a genuinely empty segment", () => {
    expect(component).not.toContain(">兜底素材<");
    expect(component).toContain("const needsMaterial");
    expect(component).toContain(">待补素材<");
    expect(component).toContain("!segment.assetTitle && !segment.assetThumbnailUrl");
  });

  test("renders every segment in one vertical list without paging or collapsing", () => {
    expect(component).toContain("segments.map((segment) =>");
    expect(component).not.toContain("segments.slice(");
    expect(component).not.toContain("展开更多");
    expect(css).toMatch(/\.shadcn-prototype-segment-actions\s*\{[^}]*flex-shrink:\s*0;/s);
  });
});
