import { describe, expect, it, vi } from "vitest";

vi.mock("@editor/constants/timeline-constants", () => ({
	TIMELINE_CONSTANTS: {
		PIXELS_PER_SECOND: 50,
		ZOOM_MAX: 100,
		ZOOM_MIN: 0.1,
	},
}));

import { getTimelineFitZoom } from "./zoom-utils";

describe("timeline fit zoom", () => {
	it("calculates the zoom needed to fit the full duration into the viewport", () => {
		expect(getTimelineFitZoom({ duration: 14, containerWidth: 700 })).toBe(1);
	});

	it("falls back to a safe duration and width when inputs are not ready", () => {
		expect(getTimelineFitZoom({ duration: 0, containerWidth: undefined })).toBe(
			20,
		);
	});
});
