import { describe, expect, it, vi } from "vitest";

import { decodeVideoAudioWithNativeAudioContext } from "./video-audio-decode";

describe("decodeVideoAudioWithNativeAudioContext", () => {
	it("retries the same persisted video file with the browser decoder", async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
		const decoded = { sampleRate: 48_000 } as AudioBuffer;
		const decodeAudioData = vi.fn().mockResolvedValue(decoded);
		const file = { arrayBuffer: vi.fn().mockResolvedValue(bytes) } as File;

		await expect(
			decodeVideoAudioWithNativeAudioContext({
				file,
				audioContext: { decodeAudioData } as unknown as AudioContext,
			}),
		).resolves.toBe(decoded);

		expect(file.arrayBuffer).toHaveBeenCalledOnce();
		expect(decodeAudioData).toHaveBeenCalledWith(bytes);
	});
});
