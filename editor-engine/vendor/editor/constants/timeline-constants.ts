import type { ElementType, TrackType } from "@editor/lib/timeline";

export const TRACK_CONFIG: Record<
	TrackType,
	{
		height: number;
		defaultName: string;
	}
> = {
	video: {
		height: 52,
		defaultName: "Video track",
	},
	text: {
		height: 22,
		defaultName: "Text track",
	},
	audio: {
		height: 40,
		defaultName: "Audio track",
	},
	graphic: {
		height: 22,
		defaultName: "Graphic track",
	},
	effect: {
		height: 22,
		defaultName: "Effect track",
	},
} as const;

export const ELEMENT_TYPE_CONFIG: Record<
	TrackType,
	{
		background: string;
		waveformColor?: string;
	}
> = {
	video: { background: "transparent" },
	text: { background: "bg-[#5DBAA0]" },
	audio: {
		background: "bg-[#8F5DBA]",
		waveformColor: "rgba(255, 255, 255, 0.5)",
	},
	graphic: { background: "bg-[#BA5D7A]" },
	effect: { background: "bg-[#5d93ba]" },
} as const;

export const ELEMENT_TRACK_MAP: Record<ElementType, TrackType> = {
	audio: "audio",
	text: "text",
	sticker: "graphic",
	graphic: "graphic",
	effect: "effect",
	video: "video",
	image: "video",
};

export const TRACK_GAP = 4;
export const TRACK_LABELS_WIDTH_PX = 72;

export const TIMELINE_RULER_HEIGHT = 18;
export const TIMELINE_BOOKMARK_ROW_HEIGHT = 16;

export const DEFAULT_BOOKMARK_COLOR = "#009dff";
export const DRAG_THRESHOLD_PX = 5;
export const TIMELINE_SCROLLBAR_SIZE_PX = 12;
export const TIMELINE_LAYERS = {
	trackContent: 10,
	dragLine: 20,
	playhead: 30,
	snapIndicator: 40,
} as const;

export const TIMELINE_CONSTANTS = {
	PIXELS_PER_SECOND: 50,
	DEFAULT_ELEMENT_DURATION: 5,
	PADDING_TOP_PX: 2,
	HORIZONTAL_WHEEL_STEP_PX: 40,
	ZOOM_MIN: 0.1,
	ZOOM_MAX: 100,
	ZOOM_BUTTON_FACTOR: 1.7,
	ZOOM_ANCHOR_PLAYHEAD_THRESHOLD: 0.15,
	TRACK_SELECTED_BG: "bg-accent/50",
} as const;
