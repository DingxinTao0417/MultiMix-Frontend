import { describe, expect, it } from "vitest";

import type { TimelineTrack } from "@editor/lib/timeline";
import type { CaptionChunk } from "@editor/lib/transcription/types";
import {
	buildCaptionElements,
	hasSubtitleTrack,
	replaceCaptionTrackElements,
	shouldStartCaptionGeneration,
} from "./caption-track";

const captions: CaptionChunk[] = [
	{ text: "新的第一句", startTime: 0, duration: 1.5 },
	{ text: "新的第二句", startTime: 1.5, duration: 1.5 },
];

function generatedCaptionElements() {
	const template = legacySubtitleTrack();
	if (template.type !== "text") throw new Error("expected a text track");
	const { id: _id, ...baseElement } = template.elements[0];
	let nextId = 0;
	return buildCaptionElements({
		captions,
		baseElement,
		createId: () => `caption-${++nextId}`,
	});
}

function legacySubtitleTrack(): TimelineTrack {
	return {
		id: "track-text",
		name: "字幕",
		type: "text",
		hidden: false,
		elements: [
			{
				id: "old-caption",
				name: "旧字幕",
				type: "text",
				content: "旧字幕内容",
				fontSize: 15,
				fontFamily: "Arial",
				color: "#ffffff",
				background: { enabled: false, color: "#000000" },
				textAlign: "center",
				fontWeight: "bold",
				fontStyle: "normal",
				textDecoration: "none",
				duration: 3,
				startTime: 0,
				trimStart: 0,
				trimEnd: 0,
				transform: {
					scaleX: 1,
					scaleY: 1,
					position: { x: 0, y: 0 },
					rotate: 0,
				},
				opacity: 1,
			},
		],
	};
}

describe("caption track replacement", () => {
	it("requires explicit confirmation before replacing existing subtitles", () => {
		let confirmationCount = 0;

		const shouldStart = shouldStartCaptionGeneration({
			tracks: [legacySubtitleTrack()],
			confirmReplacement: () => {
				confirmationCount += 1;
				return false;
			},
		});

		expect(shouldStart).toBe(false);
		expect(confirmationCount).toBe(1);
	});

	it("reuses the legacy authoritative subtitle track instead of adding another track", () => {
		const tracks = [legacySubtitleTrack()];

		const result = replaceCaptionTrackElements({
			tracks,
			elements: generatedCaptionElements(),
		});

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("track-text");
		expect(result[0].elements).toMatchObject([
			{ id: "caption-1", content: "新的第一句", textRole: "subtitle" },
			{ id: "caption-2", content: "新的第二句", textRole: "subtitle" },
		]);
		expect(hasSubtitleTrack(result)).toBe(true);
	});

	it("replaces only subtitle elements and preserves presentation support", () => {
		const track = legacySubtitleTrack();
		if (track.type !== "text") throw new Error("expected a text track");
		track.id = "mixed-text";
		track.elements[0].textRole = "subtitle";
		track.elements.push({
			...track.elements[0],
			id: "support-1",
			content: "保留的支撑信息",
			textRole: "presentation_support",
		});

		const result = replaceCaptionTrackElements({
			tracks: [track],
			elements: generatedCaptionElements().slice(0, 1),
		});

		expect(result).toHaveLength(1);
		expect(result[0].elements).toMatchObject([
			{ id: "support-1", content: "保留的支撑信息", textRole: "presentation_support" },
			{ id: "caption-1", content: "新的第一句", textRole: "subtitle" },
		]);
	});

	it("creates one authoritative subtitle track when the project has none", () => {
		const result = replaceCaptionTrackElements({
			tracks: [],
			elements: generatedCaptionElements().slice(0, 1),
		});

		expect(result).toMatchObject([
			{
				id: "track-text",
				name: "字幕",
				type: "text",
				elements: [
					{ id: "caption-1", content: "新的第一句", textRole: "subtitle" },
				],
			},
		]);
	});

	it("keeps the existing project unchanged when transcription yields no captions", () => {
		const tracks = [legacySubtitleTrack()];

		const result = replaceCaptionTrackElements({ tracks, elements: [] });

		expect(result).toBe(tracks);
		expect(result[0].elements[0]).toMatchObject({
			id: "old-caption",
			content: "旧字幕内容",
		});
	});
});
