import { describe, expect, it, vi } from "vitest";
import { getTrackHeight } from "./track-utils";
import type { TimelineTrack } from "./types";

vi.mock("@editor/constants/timeline-constants", () => ({
	TRACK_CONFIG: {
		video: { height: 52, defaultName: "Video track" },
		text: { height: 22, defaultName: "Text track" },
		audio: { height: 40, defaultName: "Audio track" },
		graphic: { height: 22, defaultName: "Graphic track" },
		effect: { height: 22, defaultName: "Effect track" },
	},
	ELEMENT_TRACK_MAP: {},
	ELEMENT_TYPE_CONFIG: {
		video: { background: "transparent" },
		text: { background: "bg-text" },
		audio: { background: "bg-audio" },
		graphic: { background: "bg-graphic" },
		effect: { background: "bg-effect" },
	},
	TRACK_GAP: 4,
}));

vi.mock("@editor/utils/id", () => ({
	generateUUID: () => "test-id",
}));

function makeVideoTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id: "track-video",
		name: "Video",
		type: "video",
		elements: [],
		isMain: true,
		muted: false,
		hidden: false,
		...overrides,
	} as TimelineTrack;
}

describe("track height", () => {
	it("renders MG overlay video tracks at half height", () => {
		const normalVideo = makeVideoTrack();
		const mgOverlay = makeVideoTrack({
			id: "track-overlay",
			name: "MG动效",
			isMain: false,
		});

		expect(getTrackHeight({ type: normalVideo.type, track: normalVideo })).toBe(52);
		expect(getTrackHeight({ type: mgOverlay.type, track: mgOverlay })).toBe(26);
	});
});
