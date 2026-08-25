import { describe, expect, it } from "vitest";

import { assertDecodedVideoFrame } from "./video-frame-contract";

describe("assertDecodedVideoFrame", () => {
	it("fails closed when an in-range video frame is unavailable", () => {
		expect(() =>
			assertDecodedVideoFrame({
				frame: null,
				mediaId: "asset-1",
				time: 12.5,
			}),
		).toThrow("Video frame unavailable during export");
	});
});
