import { describe, expect, it, vi } from "vitest";

vi.mock("@editor/lib/timeline", () => ({
	canTracktHaveAudio: (track: { type: string }) => track.type === "audio" || track.type === "video",
}));
vi.mock("@editor/lib/timeline/element-utils", () => ({
	canElementHaveAudio: (element: { type: string }) => element.type === "audio" || element.type === "video",
}));
vi.mock("@editor/lib/effects", () => ({
	effectsRegistry: { get: vi.fn() },
	resolveEffectPasses: vi.fn(() => []),
}));
vi.mock("@editor/lib/effects/definitions/blur", () => ({
	buildGaussianBlurPasses: vi.fn(() => []),
}));

import { decodeVideoAudioWithNativeAudioContext } from "./video-audio-decode";
import { createSilentTimelineAudioBuffer, hasAudibleTimelineElements } from "./audio";
import type { TimelineTrack } from "@editor/lib/timeline";

describe("hasAudibleTimelineElements", () => {
	it("recognizes an explicitly silent timeline without treating source videos as required audio", () => {
		const tracks = [
			{ type: "video", muted: false, elements: [{ type: "video", duration: 3, muted: true }] },
			{ type: "audio", muted: false, elements: [] },
		] as TimelineTrack[];

		expect(hasAudibleTimelineElements(tracks)).toBe(false);
	});

	it("still requires audio when an unmuted source exists, even if decoding later fails", () => {
		const tracks = [
			{ type: "video", muted: false, elements: [{ type: "video", duration: 3, muted: false }] },
		] as TimelineTrack[];

		expect(hasAudibleTimelineElements(tracks)).toBe(true);
	});

	it("honors track mute and zero-length clips", () => {
		const tracks = [
			{ type: "audio", muted: true, elements: [{ type: "audio", duration: 3 }] },
			{ type: "video", muted: false, elements: [{ type: "video", duration: 0 }] },
		] as TimelineTrack[];

		expect(hasAudibleTimelineElements(tracks)).toBe(false);
	});
});

describe("createSilentTimelineAudioBuffer", () => {
	it("creates a full-duration technical audio track without decoding missing source audio", () => {
		const silent = { numberOfChannels: 2, length: 1323000, sampleRate: 44100 } as AudioBuffer;
		const createBuffer = vi.fn().mockReturnValue(silent);
		const buffer = createSilentTimelineAudioBuffer({
			duration: 30,
			audioContext: { createBuffer } as unknown as AudioContext,
		});

		expect(buffer).toBe(silent);
		expect(createBuffer).toHaveBeenCalledWith(2, 1323000, 44100);
	});
});

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
