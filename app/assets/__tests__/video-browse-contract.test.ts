import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const storyboardPreviewUrl = new URL("../components/storyboard-preview.tsx", import.meta.url);
const storyboardPreview = existsSync(storyboardPreviewUrl) ? readFileSync(storyboardPreviewUrl, "utf8") : "";
const editorView = readFileSync(new URL("../../editor/EditorView.tsx", import.meta.url), "utf8");
const editorPage = readFileSync(new URL("../../editor/page.tsx", import.meta.url), "utf8");

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

  test("selects the active storyboard segment from playback time on both player paths", () => {
    expect(preview).toContain("activeSegmentAtTime");
    expect(preview).toContain("setActiveSegmentId(activeSegmentAtTime");
    expect(preview).toContain("onSelect={(segment) =>");
  });

  test("opens the embedded filmstrip on the requested segment for material replacement", () => {
    expect(preview).toContain("onEditSegment?: (segmentId: string, replaceMaterial: boolean) => void");
    expect(preview).toContain("onReplaceMaterial={(segment) => onEditSegment?.(segment.id, true)}");
    expect(editorPage).toContain('searchParams.get("segment")');
    expect(editorPage).toContain('searchParams.get("replace") === "1"');
    expect(editorView).toContain("initialSegmentId={initialSegmentId}");
    expect(editorView).toContain("openMaterialPicker={openMaterialPicker}");
  });
});
