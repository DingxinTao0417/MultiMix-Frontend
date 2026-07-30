export type VisualTransition = {
	type: string;
	duration: number;
};

export type TransitionClipRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type TransitionFrame = {
	opacityMultiplier: number;
	offsetX: number;
	clipRect?: TransitionClipRect;
};

type TransitionElement = {
	type: string;
	startTime: number;
	duration: number;
	transition?: VisualTransition;
};

const SUPPORTED_TRANSITION_TYPES = new Set([
	"fade",
	"dissolve",
	"slide_left",
	"slide_right",
	"wipe_left",
]);
const BOUNDARY_EPSILON_SECONDS = 0.000001;

function isVisualElement(element: TransitionElement | undefined): boolean {
	return element?.type === "video" || element?.type === "image";
}

function isContiguousBoundary(
	previous: TransitionElement,
	current: TransitionElement,
): boolean {
	return Math.abs(
		previous.startTime + previous.duration - current.startTime,
	) <= BOUNDARY_EPSILON_SECONDS;
}

export function normalizeVisualTransition(
	value: VisualTransition | undefined,
	maxDuration: number,
): VisualTransition | undefined {
	if (
		!value ||
		!SUPPORTED_TRANSITION_TYPES.has(value.type) ||
		!Number.isFinite(value.duration) ||
		value.duration <= 0 ||
		!Number.isFinite(maxDuration) ||
		maxDuration <= 0
	) {
		return undefined;
	}
	return { type: value.type, duration: Math.min(value.duration, maxDuration) };
}

export function resolveIncomingBoundaryTransition(
	elements: TransitionElement[],
	index: number,
	isMainTrack: boolean,
): VisualTransition | undefined {
	const current = elements[index];
	if (!isVisualElement(current)) return undefined;
	let maxDuration = current.duration / 2;
	const previous = elements[index - 1];
	if (
		isMainTrack &&
		isVisualElement(previous) &&
		isContiguousBoundary(previous, current)
	) {
		maxDuration = Math.min(maxDuration, previous.duration / 2);
	}
	return normalizeVisualTransition(current.transition, maxDuration);
}

export function resolveOutgoingBoundaryTransition(
	elements: TransitionElement[],
	index: number,
	isMainTrack: boolean,
): VisualTransition | undefined {
	if (!isMainTrack) return undefined;
	const current = elements[index];
	const next = elements[index + 1];
	if (
		!isVisualElement(current) ||
		!isVisualElement(next) ||
		!isContiguousBoundary(current, next)
	) {
		return undefined;
	}
	return resolveIncomingBoundaryTransition(elements, index + 1, true);
}

function progressAt(time: number, duration: number): number {
	return Math.min(1, Math.max(0, time / duration));
}

export function resolveTransitionFrame({
	incoming,
	outgoing,
	localTime,
	duration,
	canvasWidth,
	canvasHeight,
}: {
	incoming?: VisualTransition;
	outgoing?: VisualTransition;
	localTime: number;
	duration: number;
	canvasWidth: number;
	canvasHeight: number;
}): TransitionFrame {
	const frame: TransitionFrame = { opacityMultiplier: 1, offsetX: 0 };
	const safeIncoming = normalizeVisualTransition(incoming, duration / 2);
	if (safeIncoming && localTime < safeIncoming.duration) {
		const progress = progressAt(localTime, safeIncoming.duration);
		if (safeIncoming.type === "fade" || safeIncoming.type === "dissolve") {
			frame.opacityMultiplier = progress;
		} else if (safeIncoming.type === "slide_left") {
			frame.offsetX = -canvasWidth * (1 - progress);
		} else if (safeIncoming.type === "slide_right") {
			frame.offsetX = canvasWidth * (1 - progress);
		} else if (safeIncoming.type === "wipe_left") {
			frame.clipRect = {
				x: 0,
				y: 0,
				width: canvasWidth * progress,
				height: canvasHeight,
			};
		}
	}

	const safeOutgoing = normalizeVisualTransition(outgoing, duration / 2);
	if (safeOutgoing && localTime >= duration) {
		const progress = progressAt(localTime - duration, safeOutgoing.duration);
		if (safeOutgoing.type === "slide_left") {
			frame.offsetX = canvasWidth * progress;
		} else if (safeOutgoing.type === "slide_right") {
			frame.offsetX = -canvasWidth * progress;
		}
	}
	return frame;
}
