import { beforeEach, describe, expect, test, vi } from "vitest";

const mediaMocks = vi.hoisted(() => ({
	canvases: vi.fn(),
	dispose: vi.fn(),
	failNextRead: false,
	iteratorReturn: vi.fn(async () => ({ value: undefined, done: true })),
}));

vi.mock("mediabunny", () => {
	class FakeInput {
		async getPrimaryVideoTrack() {
			return {
				canDecode: async () => true,
			};
		}

		dispose() {
			mediaMocks.dispose();
		}
	}

	class FakeCanvasSink {
		canvases() {
			mediaMocks.canvases();
			let readCount = 0;
			return {
				async next() {
					readCount += 1;
					if (mediaMocks.failNextRead) {
						mediaMocks.failNextRead = false;
						throw new Error("decode failed");
					}
					if (readCount === 1) {
						return {
							value: {
								canvas: {},
								timestamp: 0,
								duration: 1,
							},
							done: false,
						};
					}
					return { value: undefined, done: true };
				},
				return: mediaMocks.iteratorReturn,
				[Symbol.asyncIterator]() {
					return this;
				},
			};
		}
	}

	return {
		ALL_FORMATS: {},
		BlobSource: class {},
		CanvasSink: FakeCanvasSink,
		Input: FakeInput,
	};
});

import { VideoCache } from "./service";

describe("VideoCache", () => {
	beforeEach(() => {
		mediaMocks.canvases.mockClear();
		mediaMocks.dispose.mockClear();
		mediaMocks.failNextRead = false;
		mediaMocks.iteratorReturn.mockClear();
	});

	test("serializes concurrent frame reads for the same video", async () => {
		const cache = new VideoCache();
		const file = {
			name: "clip.mp4",
			type: "video/mp4",
			size: 1,
			lastModified: 1,
		} as File;

		const [first, second] = await Promise.all([
			cache.getFrameAt({
				mediaId: "video-1",
				file,
				time: 0,
			}),
			cache.getFrameAt({
				mediaId: "video-1",
				file,
				time: 0,
			}),
		]);

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(mediaMocks.canvases).toHaveBeenCalledOnce();
		cache.clearVideo({ mediaId: "video-1" });
	});

	test("continues queued reads after an earlier read fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const cache = new VideoCache();
		const file = {
			name: "clip.mp4",
			type: "video/mp4",
			size: 1,
			lastModified: 1,
		} as File;
		mediaMocks.failNextRead = true;

		const [first, second] = await Promise.all([
			cache.getFrameAt({
				mediaId: "video-1",
				file,
				time: 0,
			}),
			cache.getFrameAt({
				mediaId: "video-1",
				file,
				time: 0,
			}),
		]);

		expect(first).toBeNull();
		expect(second).not.toBeNull();
		expect(mediaMocks.canvases).toHaveBeenCalledTimes(2);
		cache.clearVideo({ mediaId: "video-1" });
		warn.mockRestore();
	});

	test("disposes the MediaBunny input when a cached video is cleared", async () => {
		const cache = new VideoCache();
		const file = {
			name: "clip.mp4",
			type: "video/mp4",
			size: 1,
			lastModified: 1,
		} as File;

		await cache.getFrameAt({
			mediaId: "video-1",
			file,
			time: 0,
		});
		cache.clearVideo({ mediaId: "video-1" });

		expect(mediaMocks.iteratorReturn).toHaveBeenCalledOnce();
		expect(mediaMocks.dispose).toHaveBeenCalledOnce();
	});
});
