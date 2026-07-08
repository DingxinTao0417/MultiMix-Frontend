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
	});

	it("renders MG animation as normal timeline blocks instead of a collapsed summary overlay", () => {
		const timelinePanel = readProjectFile(
			"editor-engine/vendor/editor/components/editor/panels/timeline/index.tsx",
		);

		expect(timelinePanel).not.toContain("CollapsedMgTrackSummary");
		expect(timelinePanel).not.toContain("展开 MG 动效轨");
		expect(timelinePanel).not.toContain("{track.elements.length} 段");
	});
});
