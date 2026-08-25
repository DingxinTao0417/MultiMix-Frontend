import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { RootNode } from "./nodes/root-node";
import type { ExportFormat, ExportQuality } from "@editor/lib/export";
import { CanvasRenderer } from "./canvas-renderer";

type ExportParams = {
	width: number;
	height: number;
	fps: number;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
};

const qualityMap = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export async function resolveBrowserExportFormat({
	requestedFormat,
	includeAudio,
	audioBuffer,
}: {
	requestedFormat: ExportFormat;
	includeAudio: boolean;
	audioBuffer?: Pick<AudioBuffer, "sampleRate" | "numberOfChannels">;
}): Promise<ExportFormat> {
	if (requestedFormat !== "mp4" || !includeAudio || !audioBuffer) {
		return requestedFormat;
	}
	if (typeof AudioEncoder === "undefined") return "webm";
	const support = await AudioEncoder.isConfigSupported({
		codec: "mp4a.40.2",
		sampleRate: audioBuffer.sampleRate,
		numberOfChannels: audioBuffer.numberOfChannels,
		bitrate: 192000,
	});
	return support.supported ? "mp4" : "webm";
}

export function assertAudioBufferForExport({
	shouldIncludeAudio,
	audioBuffer,
}: {
	shouldIncludeAudio: boolean;
	audioBuffer?: AudioBuffer;
}): void {
	if (shouldIncludeAudio && !audioBuffer) {
		throw new Error("Source audio could not be decoded for export");
	}
}

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;

	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
	}: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<{ buffer: ArrayBuffer; format: ExportFormat } | null> {
		assertAudioBufferForExport({
			shouldIncludeAudio: this.shouldIncludeAudio,
			audioBuffer: this.audioBuffer,
		});

		const { fps } = this.renderer;
		const frameCount = Math.ceil(rootNode.duration * fps);
		const resolvedFormat = await resolveBrowserExportFormat({
			requestedFormat: this.format,
			includeAudio: this.shouldIncludeAudio,
			audioBuffer: this.audioBuffer,
		});

		const outputFormat =
			resolvedFormat === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(this.renderer.canvas, {
			codec: resolvedFormat === "webm" ? "vp9" : "avc",
			bitrate: qualityMap[this.quality],
			// Force H.264 High profile for mp4: many browsers' WebCodecs only
			// support High (avc1.6400xx), not the Baseline that mediabunny would
			// otherwise pick by default, which makes mp4 export silently fail.
			// Level 5.2 (…34) covers large portrait frames like 1080x1920.
			...(resolvedFormat === "webm" ? {} : { fullCodecString: "avc1.640034" }),
		});

		output.addVideoTrack(videoSource, { frameRate: fps });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			audioSource = new AudioBufferSource({
				codec: resolvedFormat === "webm" ? "opus" : "aac",
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const time = i / fps;
			await this.renderer.render({ node: rootNode, time });
			await videoSource.add(time, 1 / fps);

			this.emit("progress", i / frameCount);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return { buffer, format: resolvedFormat };
	}
}
