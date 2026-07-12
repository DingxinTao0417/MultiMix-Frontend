import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const storyboardPreviewUrl = new URL("../components/storyboard-preview.tsx", import.meta.url);
const storyboardPreview = existsSync(storyboardPreviewUrl) ? readFileSync(storyboardPreviewUrl, "utf8") : "";
const editorView = readFileSync(new URL("../../editor/EditorView.tsx", import.meta.url), "utf8");
const editorPage = readFileSync(new URL("../../editor/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/product-workspace.tsx", import.meta.url), "utf8");

describe("video project browse-player contract", () => {
  test("uses a lightweight storyboard surface when a ready project has no MP4", () => {
    expect(preview).toContain("<StoryboardPreview");
    expect(preview).not.toContain("mode=preview");
    expect(preview).not.toContain("shadcn-prototype-project-preview-frame");
    expect(storyboardPreview).toContain("activeSegmentId");
    expect(storyboardPreview).toContain("currentSegmentMedia");
    expect(storyboardPreview).toContain("该分镜预览暂不可用");
    expect(preview).toContain("activeId={activeSegmentId ?? product.segments?.[0]?.id ?? null}");
    expect(preview).not.toContain('hint={exportedVideoUrl ?');
    expect(editorPage).toContain('searchParams.get("mode") === "preview"');
    expect(editorView).toContain('mode?: "edit" | "preview"');
    expect(editorView).toContain("editor-preview-only");
  });

  test("loads only the active segment media instead of hydrating the whole editor project", () => {
    expect(storyboardPreview).toContain("findMediaForSegment");
    expect(storyboardPreview).toContain("mediaUrlForRef");
    expect(storyboardPreview).not.toContain("initEditorWithProject");
    expect(storyboardPreview).not.toContain("Promise.all");
  });

  test("keeps storyboard and player surfaces aligned with the project ratio", () => {
    expect(storyboardPreview).toContain("getProductRatioClass(product.ratio)");
    expect(css).toMatch(/ratio-landscape[^{}]*\.shadcn-prototype-project-preview-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
    expect(css).toMatch(/ratio-portrait[^{}]*\.shadcn-prototype-project-preview-screen\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/s);
    expect(css).toMatch(/ratio-landscape[^{}]*\.shadcn-prototype-product-video-player\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
    expect(css).toMatch(/ratio-landscape[^{}]*\.shadcn-prototype-video-placeholder-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  });

  test("selects the active storyboard segment from playback time on both player paths", () => {
    expect(preview).toContain("activeSegmentAtTime");
    expect(preview).toContain("setActiveSegmentId(activeSegmentAtTime");
    expect(preview).toContain("onSelect={(segment) =>");
  });

  test("opens the material picker in browse mode instead of entering the editor", () => {
    expect(preview).toContain("onReplaceMaterial?: (segment: AssetProductSegment) => void");
    expect(preview).toContain("onReplaceMaterial={onReplaceMaterial}");
    expect(workspace).toContain("<AssetPicker");
    expect(workspace).toContain("openBrowseMaterialPicker");
    expect(workspace).not.toContain("setOpenSegmentMaterialPicker");
    expect(editorPage).toContain('searchParams.get("segment")');
    expect(editorView).toContain("initialSegmentId={initialSegmentId}");
  });

  test("keeps one editor iframe mounted as a hidden export bridge while browsing", () => {
    expect(workspace).toContain("shadcn-prototype-export-bridge");
    expect(workspace).toContain("{exportButtonLabel}");
    expect(workspace).toContain("canBrowseVideo ? (");
  });
});
