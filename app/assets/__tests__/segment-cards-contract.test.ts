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

  test("shows a replace-material action only on hover or keyboard focus", () => {
    expect(component).toContain("onReplaceMaterial?: (segment: AssetProductSegment) => void");
    expect(component).toContain("shadcn-prototype-segment-actions");
    expect(component).toContain("换素材");
    expect(component).toContain("event.stopPropagation()");
    expect(css).toMatch(/\.shadcn-prototype-segment-cards li:(?:hover|focus-within)[^{]*\.shadcn-prototype-segment-actions/s);
    expect(css).not.toMatch(/\.shadcn-prototype-segment-cards li\.active \.shadcn-prototype-segment-actions/s);
  });

  test("exposes a voiceover action without changing the card selection target", () => {
    expect(component).toContain("onEditVoiceover?: (segment: AssetProductSegment) => void");
    expect(component).toContain("修改配音");
    expect(component).toContain("onEditVoiceover(segment)");
    expect(component.match(/event\.stopPropagation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(css).toMatch(/\.shadcn-prototype-segment-actions\s*\{[^}]*gap:\s*6px;/s);
  });

  test("styles the shared voiceover form inside the browse dialog", () => {
    expect(css).toContain(".shadcn-prototype-voiceover-dialog-body");
    expect(css).toMatch(/\.shadcn-prototype-voiceover-dialog-body \.shadcn-prototype-voiceover-editor\s*\{[^}]*display:\s*grid;/s);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shadcn-prototype-voiceover-dialog/s);
    expect(css).not.toContain(".shadcn-prototype-preview-player.voiceover");
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
    expect(component).toContain("!segment.assetTitle");
    expect(component).toContain("!segment.assetThumbnailUrl");
    expect(component).toContain("segment.primaryVisualSourceType !== \"generated_scene\"");
    expect(component).toContain("segment.visualStatusLabel");
    expect(component).toContain("segment.businessHint");
    expect(component).toContain('segment.primaryVisualSourceType !== "generated_scene"');
    expect(component).toContain('segment.primaryVisualMediaType === "video"');
    expect(component).toContain("shadcn-prototype-segment-video-placeholder");
    expect(component).not.toContain("<video");
  });

  test("renders every segment in one vertical list without paging or collapsing", () => {
    expect(component).toContain("segments.map((segment) =>");
    expect(component).not.toContain("segments.slice(");
    expect(component).not.toContain("展开更多");
    expect(css).toMatch(/\.shadcn-prototype-segment-actions\s*\{[^}]*flex-shrink:\s*0;/s);
  });

  test("shows the planned presentation and its reason without internal pipeline terms", () => {
    expect(component).toContain("segment.visualTreatmentLabel");
    expect(component).toContain("segment.selectionReason");
    expect(component).toContain("segment.graphicComponentLabel");
    expect(component).toContain("segment.backgroundTreatmentLabel");
    expect(component).toContain("segment.publicReplacementNote");
    expect(component).not.toContain("mg_scene");
    expect(component).not.toContain("pipeline_code");
  });

  test("keeps scrollable-card shadows inside a padded paint area", () => {
    expect(css).toMatch(/\.shadcn-prototype-video-browse\s*>\s*\.shadcn-prototype-segment-cards\s*>\s*ol\s*\{[^}]*padding:\s*4px 12px 24px;[^}]*margin:\s*-4px -12px 0;/s);
  });
});
