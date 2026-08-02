import { describe, expect, it } from "vitest";

import {
	locateSubtitleTokenInLines,
	resolveSubtitleTokenStates,
} from "../../../lib/text/subtitle-presentation";

describe("resolveSubtitleTokenStates", () => {
	it("marks only the current word active for word-highlight subtitles", () => {
		const states = resolveSubtitleTokenStates({
			mode: "word_highlight",
			tokens: [
				{ text: "上传", startOffset: 0, endOffset: 0.5 },
				{ text: "资料", startOffset: 0.5, endOffset: 1 },
			],
			localTime: 0.75,
		});

		expect(states.map((item) => item.state)).toEqual(["past", "active"]);
	});

	it("leaves all words normal for static subtitles", () => {
		const states = resolveSubtitleTokenStates({
			mode: "static_phrase",
			tokens: [{ text: "上传", startOffset: 0, endOffset: 0.5 }],
			localTime: 0.25,
		});

		expect(states.map((item) => item.state)).toEqual(["normal"]);
	});

	it("locates the active token on a wrapped second subtitle line", () => {
		expect(
			locateSubtitleTokenInLines({
				content: "上传资料\n生成视频",
				lines: ["上传资料", "生成视频"],
				tokens: [
					{ text: "上传", startOffset: 0, endOffset: 0.4 },
					{ text: "资料", startOffset: 0.4, endOffset: 0.8 },
					{ text: "生成", startOffset: 0.8, endOffset: 1.2 },
					{ text: "视频", startOffset: 1.2, endOffset: 1.6 },
				],
				activeTokenIndex: 2,
			}),
		).toEqual({ lineIndex: 1, charOffset: 0 });
	});
});
