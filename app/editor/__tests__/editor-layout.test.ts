import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
	return readFileSync(join(root, path), "utf8");
}

describe("editor layout constraints", () => {
	it("uses a fixed timeline height and no draggable preview/timeline resizer", () => {
		const view = readProjectFile("app/editor/EditorView.tsx");
		const css = readProjectFile("app/editor/editor.css");
		const timelinePanel = readProjectFile(
			"editor-engine/vendor/editor/components/editor/panels/timeline/index.tsx",
		);
		const timelineZoom = readProjectFile(
			"editor-engine/vendor/editor/hooks/timeline/use-timeline-zoom.ts",
		);

		expect(view).not.toContain("editor-layout-resizer");
		expect(css).not.toContain("editor-layout-resizer");
		expect(css).toContain("minmax(0, 1fr) clamp(210px, 28vh, 320px)");
		expect(timelinePanel).toContain("getTimelineFitZoom");
		expect(timelinePanel).toContain("autoFitZoom");
		expect(timelinePanel).toContain("savedViewState?.userAdjustedZoom");
		expect(timelineZoom).toContain("hasUserAdjustedZoomRef");
		expect(timelineZoom).toContain("markUserAdjusted");
		expect(timelineZoom).toContain("userAdjustedZoom");
	});

	it("keeps preview controls inside the preview area with hidden centered playback", () => {
		const view = readProjectFile("app/editor/EditorView.tsx");
		const previewPanel = readProjectFile(
			"editor-engine/vendor/editor/components/editor/panels/preview/index.tsx",
		);
		const previewToolbar = readProjectFile(
			"editor-engine/vendor/editor/components/editor/panels/preview/toolbar.tsx",
		);
		const timelineToolbar = readProjectFile(
			"editor-engine/vendor/editor/components/editor/panels/timeline/timeline-toolbar.tsx",
		);

		expect(previewToolbar).not.toContain("PreviewUtilityControlsPortal");
		expect(previewToolbar).not.toContain("createPortal");
		expect(previewToolbar).toContain("top-1/2 left-1/2");
		expect(previewToolbar).toContain("opacity-0");
		expect(previewToolbar).toContain("preview-play-button");
		expect(previewToolbar).toContain("showPlaybackButton");
		expect(previewToolbar).toContain("bottom-4 right-4");
		expect(previewPanel).toContain("isPointerOverCanvas");
		expect(previewPanel).toContain("preview-video-surface");
		expect(previewPanel).toContain("preview-canvas-controls");
		expect(previewPanel).toContain("left: viewport.sceneLeft");
		expect(previewPanel).toContain("width: viewport.sceneWidth");
		expect(previewToolbar).not.toContain("grid grid-cols");
		expect(previewToolbar).not.toContain("<TimecodeDisplay />");
		expect(previewToolbar).not.toContain("formatTimeCode");
		expect(timelineToolbar).not.toContain("editor-preview-toolbar-slot");
		expect(view).toContain('message.type === "multimix-editor-bgm-open"');
		expect(view).toContain("open={isBgmPanelOpen}");
	});

	it("sizes the embedded editor from the product column and canvas ratio", () => {
		const workspace = readProjectFile("app/assets/components/product-workspace.tsx");
		const css = readProjectFile("app/globals.css");

		expect(workspace).toContain("shadcn-prototype-product-main shadcn-prototype-editor-host");
		expect(workspace).toContain("getProductRatioClass(product.ratio)");
		expect(css).toContain("container-type: inline-size");
		expect(css).toContain("calc(56.25cqw + 230px)");
		expect(css).toContain("calc(177.78cqw + 230px)");
	});

	it("renders MG animation as normal timeline blocks instead of a collapsed summary overlay", () => {
		const timelinePanel = readProjectFile(
			"editor-engine/vendor/editor/components/editor/panels/timeline/index.tsx",
		);

		expect(timelinePanel).not.toContain("CollapsedMgTrackSummary");
		expect(timelinePanel).not.toContain("展开 MG 动效轨");
		expect(timelinePanel).not.toContain("{track.elements.length} 段");
	});

	it("verifies the rendered MP4 before handing it to the parent for a user-initiated download", () => {
		const view = readProjectFile("app/editor/EditorView.tsx");
		const localPreflight = view.indexOf("inspectEditorProject(currentProject)");
		const render = view.indexOf("renderer.exportProject");
		const remoteVerification = view.indexOf("/exports/verify");
		const verifiedBlobHandoff = view.indexOf('type: "multimix-editor-export-success", report: verifiedReport, blob');

		expect(localPreflight).toBeGreaterThan(-1);
		expect(localPreflight).toBeLessThan(render);
		expect(remoteVerification).toBeGreaterThan(render);
		expect(verifiedBlobHandoff).toBeGreaterThan(remoteVerification);
		expect(view).not.toContain("anchor.click()");
	});

	it("waits for real jobs before the full-screen editor reloads material or manual MG changes", () => {
		const panel = readProjectFile("editor-engine/vendor/ReplacePanel.tsx");
		const api = readProjectFile("editor-engine/vendor/api.ts");

		expect(api).toContain('from "@/lib/video-project-client"');
		expect(api).not.toContain("/segments/${encodeURIComponent(segmentId)}/recompose");
		expect(panel).toContain("async function waitForVideoJob(jobId: string)");
		expect(panel).toContain("await waitForVideoJob(result.job.id)");
		expect(panel).toContain("if (res.id) await waitForVideoJob(res.id)");
		expect(panel.indexOf("await waitForVideoJob(result.job.id)")).toBeLessThan(
			panel.indexOf("await reloadAndClose()"),
		);
	});

	it("does not expose material replacement before a visual timeline segment is selected", () => {
		const panel = readProjectFile("editor-engine/vendor/ReplacePanel.tsx");
		expect(panel).toContain("if (!canReplace) return null;");
	});
});
