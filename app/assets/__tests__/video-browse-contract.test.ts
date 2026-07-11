import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const editorView = readFileSync(new URL("../../editor/EditorView.tsx", import.meta.url), "utf8");
const editorPage = readFileSync(new URL("../../editor/page.tsx", import.meta.url), "utf8");

describe("video project browse-player contract", () => {
  test("uses a preview-only editor surface when a ready project has no MP4", () => {
    expect(preview).toContain("mode=preview");
    expect(preview).toContain("shadcn-prototype-project-preview-frame");
    expect(preview).not.toContain('hint={exportedVideoUrl ?');
    expect(editorPage).toContain('searchParams.get("mode") === "preview"');
    expect(editorView).toContain('mode?: "edit" | "preview"');
    expect(editorView).toContain("editor-preview-only");
  });

  test("bridges seek, play, pause and playback state between workspace and preview", () => {
    expect(preview).toContain("multimix-editor-preview-seek");
    expect(preview).toContain("multimix-editor-preview-toggle");
    expect(preview).toContain("multimix-editor-preview-state");
    expect(editorView).toContain("editor.playback.seek");
    expect(editorView).toContain("editor.playback.toggle");
    expect(editorView).toContain("editor.playback.subscribe");
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
