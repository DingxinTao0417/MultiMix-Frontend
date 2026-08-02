import type {
	TextElement,
	TextTrack,
	TimelineTrack,
} from "../timeline";
import type { CaptionChunk } from "./types";

function isSubtitleTrack(track: TimelineTrack): track is TextTrack {
	return (
		track.type === "text" &&
		(track.id === "track-text" ||
			track.elements.some((element) => element.textRole === "subtitle"))
	);
}

export function hasSubtitleTrack(tracks: TimelineTrack[]): boolean {
	return tracks.some(isSubtitleTrack);
}

export function shouldStartCaptionGeneration({
	tracks,
	confirmReplacement,
}: {
	tracks: TimelineTrack[];
	confirmReplacement: () => boolean;
}): boolean {
	return !hasSubtitleTrack(tracks) || confirmReplacement();
}

export function buildCaptionElements({
	captions,
	baseElement,
	createId,
}: {
	captions: CaptionChunk[];
	baseElement: Omit<TextElement, "id">;
	createId: () => string;
}): TextElement[] {
	return captions.map((caption, index) => ({
		...baseElement,
		id: createId(),
		name: `Caption ${index + 1}`,
		content: caption.text,
		duration: caption.duration,
		startTime: caption.startTime,
		fontSize: 65,
		fontWeight: "bold",
		textRole: "subtitle",
		background: { ...baseElement.background },
		transform: {
			...baseElement.transform,
			position: { ...baseElement.transform.position },
		},
	}));
}

export function replaceCaptionTrackElements({
	tracks,
	elements,
	insertIndex = tracks.length,
}: {
	tracks: TimelineTrack[];
	elements: TextElement[];
	insertIndex?: number;
}): TimelineTrack[] {
	if (elements.length === 0) return tracks;
	const existingIndex = tracks.findIndex(isSubtitleTrack);

	if (existingIndex >= 0) {
		return tracks.map((track, index) => {
			if (index !== existingIndex || track.type !== "text") return track;
			const preserved = track.elements.filter(
				(element) => element.textRole && element.textRole !== "subtitle",
			);
			return { ...track, elements: [...preserved, ...elements] };
		});
	}

	const subtitleTrack: TextTrack = {
		id: "track-text",
		name: "字幕",
		type: "text",
		hidden: false,
		elements,
	};
	const result = [...tracks];
	result.splice(Math.max(0, Math.min(insertIndex, result.length)), 0, subtitleTrack);
	return result;
}
