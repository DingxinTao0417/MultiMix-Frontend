import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import { VisualNode, type VisualNodeParams } from "./visual-node";
import { videoCache } from "@editor/services/video-cache/service";
import { assertDecodedVideoFrame } from "./video-frame-contract";

export interface VideoNodeParams extends VisualNodeParams {
	url: string;
	file: File;
	mediaId: string;
	// MG overlay media carries a VP8/VP9 alpha channel; opt into alpha decoding.
	hasAlpha?: boolean;
}

export class VideoNode extends VisualNode<VideoNodeParams> {
	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const videoTime = this.getSourceLocalTime({ time });

		const frame = await videoCache.getFrameAt({
			mediaId: this.params.mediaId,
			file: this.params.file,
			time: videoTime,
			alpha: this.params.hasAlpha,
		});

		const decodedFrame = assertDecodedVideoFrame({
			frame,
			mediaId: this.params.mediaId,
			time: videoTime,
		});
		const source = this.params.hasAlpha
			? this.keyOutDecodedBlackAlpha({ source: decodedFrame.canvas })
			: decodedFrame.canvas;
		this.renderVisual({
			renderer,
			source,
			sourceWidth: decodedFrame.canvas.width,
			sourceHeight: decodedFrame.canvas.height,
			timelineTime: time,
		});
	}

	private keyOutDecodedBlackAlpha({
		source,
	}: {
		source: CanvasImageSource & { width: number; height: number };
	}): CanvasImageSource {
		const canvas = createOffscreenCanvas({
			width: source.width,
			height: source.height,
		});
		const ctx = canvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!ctx) return source;

		try {
			ctx.drawImage(source, 0, 0);
			const image = ctx.getImageData(0, 0, source.width, source.height);
			const data = image.data;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i] < 12 && data[i + 1] < 12 && data[i + 2] < 12) {
					data[i + 3] = 0;
				}
			}
			ctx.putImageData(image, 0, 0);
			return canvas;
		} catch {
			return source;
		}
	}
}
