import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const storyboardPreviewUrl = new URL("../components/storyboard-preview.tsx", import.meta.url);
const storyboardPreview = existsSync(storyboardPreviewUrl) ? readFileSync(storyboardPreviewUrl, "utf8") : "";
const projectPreviewUrl = new URL("../components/video-project-preview.tsx", import.meta.url);
const projectPreview = existsSync(projectPreviewUrl) ? readFileSync(projectPreviewUrl, "utf8") : "";
const editorView = readFileSync(new URL("../../editor/EditorView.tsx", import.meta.url), "utf8");
const editorBootstrap = readFileSync(
  new URL("../../../editor-engine/vendor/bootstrap.ts", import.meta.url),
  "utf8",
);
const filmStrip = readFileSync(new URL("../../editor/FilmStrip.tsx", import.meta.url), "utf8");
const editorPage = readFileSync(new URL("../../editor/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/product-workspace.tsx", import.meta.url), "utf8");

describe("video project browse-player contract", () => {
  test("mounts the read-only engineering preview for a ready project", () => {
    expect(preview).toContain("<VideoProjectPreview");
    expect(preview).toContain("<VideoPreviewPlayer");
    expect(preview).not.toContain("<VideoPreviewResizer");
    expect(preview).not.toContain("previewHeight");
    expect(preview).toContain("exportedVideoUrl && !fullVideoFailed");
    expect(preview).toContain("projectPreviewRequested && !projectPreviewFailed");
    expect(preview).toContain('useState(true)');
    expect(preview).toMatch(/setFullVideoFailed\(false\);\s*setProjectPreviewRequested\(true\);\s*setProjectPreviewFailed\(false\);/s);
    expect(preview).toContain("加载完整工程预览");
    expect(preview).not.toContain("点击任意分镜可跳转成片");
    expect(preview).not.toContain("点击任意分镜可切换预览");
    expect(projectPreview).toContain("mode=preview");
    expect(projectPreview).toContain("shadcn-prototype-project-preview-frame");
    expect(projectPreview).toContain("multimix-editor-preview-state");
    expect(projectPreview).toContain("multimix-editor-preview-toggle");
    expect(projectPreview).toContain("multimix-editor-preview-seek");
    expect(projectPreview).toContain("data.previewChannel !== previewChannel");
    expect(projectPreview).toContain("previewChannel=");
    expect(preview).toContain("activeId={activeSegmentId ?? product.segments?.[0]?.id ?? null}");
    expect(preview).not.toContain("hint=");
    expect(editorPage).toContain('searchParams.get("mode") === "preview"');
    expect(editorView).toContain('mode?: "edit" | "preview"');
    expect(editorPage).toContain('searchParams.get("previewChannel")');
    expect(editorView).toContain("previewChannel");
    expect(editorView).toContain("editor-preview-only");
  });

  test("keeps a playable full-project preview available for manual review", () => {
    expect(storyboardPreview).toContain("findMediaForSegment");
    expect(storyboardPreview).toContain("mediaUrlForRef");
    expect(storyboardPreview).not.toContain("initEditorWithProject");
    expect(storyboardPreview).not.toContain("Promise.all");
    expect(preview).toContain("onError={() => setProjectPreviewFailed(true)}");
    expect(preview).toContain("setProjectPreviewRequested(true)");
    expect(preview).not.toContain("shouldOwnRenderedReview");
    expect(preview).toContain("重新加载完整工程预览");
  });

  test("renders segment videos as a complete player inside the shared shell", () => {
    const playerPosition = storyboardPreview.indexOf("<VideoPreviewPlayer");
    const mediaScreenPosition = storyboardPreview.indexOf('<div className="shadcn-prototype-project-preview-screen">');
    expect(playerPosition).toBeGreaterThan(0);
    expect(mediaScreenPosition).toBeGreaterThan(playerPosition);
    expect(storyboardPreview).toContain("const showSegmentVideo = !failed && currentSegmentMedia?.kind === \"video\"");
  });

  test("keeps storyboard and player surfaces aligned with the project ratio", () => {
    expect(storyboardPreview).toContain("getProductRatioClass(product.ratio)");
    expect(css).toMatch(/ratio-landscape[^{}]*\.shadcn-prototype-project-preview-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
    expect(css).toMatch(/ratio-portrait[^{}]*\.shadcn-prototype-project-preview-screen\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/s);
    expect(css).toMatch(/\.shadcn-prototype-preview-player\.ratio-landscape\s+\.shadcn-prototype-preview-player-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
    expect(css).toMatch(/\.shadcn-prototype-preview-player\.ratio-portrait\s+\.shadcn-prototype-preview-player-screen\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/s);
    expect(css).not.toMatch(/\.shadcn-prototype-preview-player\.ratio-(?:landscape|portrait)\s*\{[^}]*aspect-ratio:/s);
    expect(css).toMatch(/ratio-landscape[^{}]*\.shadcn-prototype-video-placeholder-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  });

  test("selects the active storyboard segment from playback time on both player paths", () => {
    expect(preview).toContain("activeSegmentAtTime");
    expect(preview).toContain("setActiveSegmentId(activeSegmentAtTime");
    expect(preview).toContain("onSelect={(segment) =>");
    expect(preview).toContain("projectPreviewRef.current?.seekAndPlay");
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

  test("mounts the editor export bridge only after explicit edit or export intent", () => {
    expect(workspace).toContain("shadcn-prototype-export-bridge");
    expect(workspace).toContain("{exportButtonLabel}");
    expect(workspace).toContain("canBrowseVideo ? (");
    expect(workspace).toContain("{!isTextEditing && hasVideoProject && editorRequested ? (");
    expect(workspace).toContain("pendingExportRef.current = true");
    expect(workspace).toContain('setExportState("preparing")');
    expect(workspace).toContain('type: "multimix-editor-sync"');
    expect(workspace).toContain('type: "multimix-editor-ready-ack"');
    expect(editorView).toContain('message.type === "multimix-editor-sync"');
    expect(editorView).toContain('message.type === "multimix-editor-ready-ack"');
    expect(editorView).toContain('/mp4');
    expect(workspace).not.toContain("{hasVideoProject && !mgOverlayPending ? (");
  });

  test("does not use a legacy automated review record to reset or block export", () => {
    expect(workspace).not.toContain("persistedRenderedReviewFingerprint");
    expect(workspace).not.toContain("等待画面检查");
  });

  test("notifies the workbench only after embedded edits persist a new project", () => {
    expect(editorView).toContain('type: "multimix-editor-project-updated"');
    expect(editorView).toContain("handleBgmProjectChanged");
    expect(filmStrip).toContain('type: "multimix-editor-project-updated"');
    expect(filmStrip).toContain("job.status === \"completed\"");
    expect(workspace).toContain('case "multimix-editor-project-updated"');
    expect(workspace).toContain("refreshPersistedVideoProject");
  });

  test("does not automatically capture, upload, or poll final-frame review", () => {
    expect(editorView).not.toContain("captureRenderedReviewFrames");
    expect(editorView).not.toContain("uploadRenderedReviewFrames");
    expect(editorView).not.toContain("fetchLatestRenderedReview");
    expect(editorView).not.toContain("画面检查通过后才能导出");
  });

  test("keeps the mounted preview on one editor instance without a review sidecar", () => {
    expect(editorView.match(/await initEditorWithProject\(/g)).toHaveLength(1);
    expect(editorView.match(/await refreshMountedEditorProject\(/g)).toHaveLength(1);
    expect(editorView).toMatch(
      /async function refreshMountedEditorProject[\s\S]*?setRenderTree\(\{\s*renderTree:\s*null\s*\}\)[\s\S]*?await updateEditorProject\(project\)/,
    );
    expect(editorBootstrap).toMatch(
      /updateEditorProject[\s\S]*?editor\.media\.clearAllAssets\(\)[\s\S]*?applyProject\(editor,\s*bp\)/,
    );
  });
});
