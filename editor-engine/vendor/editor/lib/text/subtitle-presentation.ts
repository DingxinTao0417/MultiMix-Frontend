import type { SubtitlePresentationMode, SubtitleToken } from "../timeline/types";

export type SubtitleTokenState = "normal" | "past" | "active" | "future";

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
