import { describe, expect, it } from "vitest";

import {
	locateSubtitleTokenInLines,
	resolveSubtitleOutlineStyle,
	resolveSubtitleTokenStates,
} from "../../../lib/text/subtitle-presentation";

describe("resolveSubtitleOutlineStyle", () => {
	it("adds a dark contrast outline to light subtitles without a background", () => {
		expect(
			resolveSubtitleOutlineStyle({
				textRole: "subtitle",
				backgroundEnabled: false,
				textColor: "#ffffff",
				fontSize: 48,
			}),
		).toEqual({ color: "rgba(0, 0, 0, 0.78)", width: 4.32 });
	});

	it("adds a light contrast outline to dark subtitles without a background", () => {
		expect(
			resolveSubtitleOutlineStyle({
				textRole: "subtitle",
				backgroundEnabled: false,
				textColor: "#123b35",
				fontSize: 48,
			}),
		).toEqual({ color: "rgba(255, 255, 255, 0.84)", width: 4.32 });
	});

	it("does not outline non-subtitles or subtitles with a background", () => {
		expect(
			resolveSubtitleOutlineStyle({
				textRole: "presentation_support",
				backgroundEnabled: false,
				textColor: "#ffffff",
				fontSize: 48,
			}),
		).toBeNull();
		expect(
			resolveSubtitleOutlineStyle({
				textRole: "subtitle",
				backgroundEnabled: true,
				textColor: "#ffffff",
				fontSize: 48,
			}),
		).toBeNull();
	});
});

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
