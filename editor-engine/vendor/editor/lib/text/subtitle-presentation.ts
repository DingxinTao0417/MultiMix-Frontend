import type { SubtitlePresentationMode, SubtitleToken } from "../timeline/types";

export type SubtitleTokenState = "normal" | "past" | "active" | "future";

function parseColorChannels(color: string): [number, number, number] | null {
	const normalized = color.trim().toLowerCase();
	const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(normalized);
	if (shortHex) {
		return shortHex.slice(1).map((channel) => Number.parseInt(`${channel}${channel}`, 16)) as [
			number,
			number,
			number,
		];
	}
	const longHex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(
		normalized,
	);
	if (longHex) {
		return longHex.slice(1, 4).map((channel) => Number.parseInt(channel, 16)) as [
			number,
			number,
			number,
		];
	}
	const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(
		normalized,
	);
	if (!rgb) return null;
	return rgb.slice(1, 4).map((channel) => Math.min(255, Number(channel))) as [
		number,
		number,
		number,
	];
}

export function resolveSubtitleOutlineStyle({
	textRole,
	backgroundEnabled,
	textColor,
	fontSize,
}: {
	textRole?: string;
	backgroundEnabled: boolean;
	textColor: string;
	fontSize: number;
}): { color: string; width: number } | null {
	if (textRole !== "subtitle" || backgroundEnabled) return null;
	const [red, green, blue] = parseColorChannels(textColor) ?? [255, 255, 255];
	const perceivedBrightness = red * 0.299 + green * 0.587 + blue * 0.114;
	return {
		color:
			perceivedBrightness >= 150
				? "rgba(0, 0, 0, 0.78)"
				: "rgba(255, 255, 255, 0.84)",
		width: Math.max(2, fontSize * 0.09),
	};
}

export function resolveSubtitleTokenStates({
	mode,
	tokens,
	localTime,
}: {
	mode: SubtitlePresentationMode;
	tokens: SubtitleToken[];
	localTime: number;
}): Array<SubtitleToken & { state: SubtitleTokenState }> {
	return tokens.map((token) => {
		if (mode === "static_phrase") return { ...token, state: "normal" };
		if (localTime < token.startOffset) return { ...token, state: "future" };
		if (localTime >= token.endOffset) return { ...token, state: "past" };
		return { ...token, state: "active" };
	});
}

/** Locate one ordered subtitle token after the layout has wrapped text into lines. */
export function locateSubtitleTokenInLines({
	content,
	lines,
	tokens,
	activeTokenIndex,
}: {
	content: string;
	lines: string[];
	tokens: SubtitleToken[];
	activeTokenIndex: number;
}): { lineIndex: number; charOffset: number } | null {
	if (activeTokenIndex < 0 || activeTokenIndex >= tokens.length) return null;
	let cursor = 0;
	let tokenOffset = -1;
	for (let index = 0; index <= activeTokenIndex; index += 1) {
		const token = tokens[index];
		const found = content.indexOf(token.text, cursor);
		if (found < 0) return null;
		if (index === activeTokenIndex) tokenOffset = found;
		cursor = found + token.text.length;
	}
	let lineStart = 0;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		if (tokenOffset >= lineStart && tokenOffset < lineStart + line.length) {
			return { lineIndex, charOffset: tokenOffset - lineStart };
		}
		lineStart += line.length + 1;
	}
	return null;
}
