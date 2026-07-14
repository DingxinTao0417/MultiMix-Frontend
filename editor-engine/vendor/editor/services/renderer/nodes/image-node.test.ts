import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./visual-node", () => ({
	VisualNode: class {
		constructor(_params: unknown) {}
	},
}));

import { loadImageSource } from "./image-node";

describe("loadImageSource", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sets anonymous CORS before assigning a cross-origin media URL", async () => {
		const assignments: Array<{ crossOrigin: string | null; src: string }> = [];

		class FakeImage {
			crossOrigin: string | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			naturalWidth = 1080;
			naturalHeight = 1920;

			set src(value: string) {
				assignments.push({ crossOrigin: this.crossOrigin, src: value });
				queueMicrotask(() => this.onload?.());
			}
		}

		vi.stubGlobal("Image", FakeImage);
		await loadImageSource("http://127.0.0.1:8299/v1/video/media?ref=title-card.svg");

		expect(assignments).toEqual([{
			crossOrigin: "anonymous",
			src: "http://127.0.0.1:8299/v1/video/media?ref=title-card.svg",
		}]);
	});
});
