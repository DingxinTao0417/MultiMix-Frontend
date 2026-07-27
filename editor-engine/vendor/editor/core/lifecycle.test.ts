import { describe, expect, test, vi } from "vitest";

import { disposeEditorResources } from "./lifecycle";

describe("editor resource lifecycle", () => {
	test("releases every long-lived resource in dependency-safe order", () => {
		const calls: string[] = [];
		const editor = {
			playback: {
				pause: vi.fn(() => calls.push("playback")),
			},
			renderer: {
				setRenderTree: vi.fn(() => calls.push("renderer")),
			},
			audio: {
				dispose: vi.fn(() => calls.push("audio")),
			},
			media: {
				clearAllAssets: vi.fn(() => calls.push("media")),
			},
			save: {
				stop: vi.fn(() => calls.push("save")),
			},
		};

		disposeEditorResources(editor);

		expect(editor.renderer.setRenderTree).toHaveBeenCalledWith({
			renderTree: null,
		});
		expect(calls).toEqual([
			"playback",
			"renderer",
			"audio",
			"media",
			"save",
		]);
	});
});
