import {
	Input,
	ALL_FORMATS,
	BlobSource,
	CanvasSink,
	type WrappedCanvas,
} from "mediabunny";

interface VideoSinkData {
	input: Input;
	sink: CanvasSink;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	currentFrame: WrappedCanvas | null;
	nextFrame: WrappedCanvas | null;
	lastTime: number;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
}

export class VideoCache {
	private sinks = new Map<string, VideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();
	private failedSignatures = new Map<string, string>();
	private frameRequestTails = new Map<string, Promise<void>>();
	private frameRequestGenerations = new Map<string, number>();

	async getFrameAt({
		mediaId,
		file,
		time,
		alpha,
	}: {
		mediaId: string;
		file: File;
		time: number;
		alpha?: boolean;
	}): Promise<WrappedCanvas | null> {
		if (file.size === 0) return null;

		const generation = this.frameRequestGenerations.get(mediaId) ?? 0;
		const previousRequest = this.frameRequestTails.get(mediaId)
			?? Promise.resolve();
		let releaseRequest = () => {};
		const currentRequest = new Promise<void>((resolve) => {
			releaseRequest = resolve;
		});
		const requestTail = previousRequest
			.catch(() => undefined)
			.then(() => currentRequest);
		this.frameRequestTails.set(mediaId, requestTail);

		try {
			await previousRequest.catch(() => undefined);
			if ((this.frameRequestGenerations.get(mediaId) ?? 0) !== generation) {
				return null;
			}

			const signature = this.fileSignature({ file });
			if (this.failedSignatures.get(mediaId) === signature) return null;

			await this.ensureSink({ mediaId, file, alpha });
			if ((this.frameRequestGenerations.get(mediaId) ?? 0) !== generation) {
				this.disposeSink({ mediaId });
				return null;
			}
			const frame = await this.getFrameFromSink({ mediaId, time });
			if ((this.frameRequestGenerations.get(mediaId) ?? 0) !== generation) {
				return null;
			}
			return frame;
		} catch (error) {
			this.failedSignatures.set(mediaId, this.fileSignature({ file }));
			console.warn("Skipping undecodable video media", {
				mediaId,
				name: file.name,
				type: file.type,
				size: file.size,
				error,
			});
			return null;
		} finally {
			releaseRequest();
			if (this.frameRequestTails.get(mediaId) === requestTail) {
				this.frameRequestTails.delete(mediaId);
			}
		}
	}

	private async getFrameFromSink({
		mediaId,
		time,
	}: {
		mediaId: string;
		time: number;
	}): Promise<WrappedCanvas | null> {
		const sinkData = this.sinks.get(mediaId);
		if (!sinkData) return null;

		if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
			sinkData.currentFrame = sinkData.nextFrame;
			sinkData.nextFrame = null;
			this.startPrefetch({ sinkData });
		}

		if (
			sinkData.currentFrame &&
			this.isFrameValid({ frame: sinkData.currentFrame, time })
		) {
			if (!sinkData.nextFrame && !sinkData.prefetching) {
				this.startPrefetch({ sinkData });
			}
			return sinkData.currentFrame;
		}

		if (
			sinkData.iterator &&
			sinkData.currentFrame &&
			time >= sinkData.lastTime &&
			time < sinkData.lastTime + 2.0
		) {
			const frame = await this.iterateToTime({ sinkData, targetTime: time });
			if (frame) {
				if (!sinkData.nextFrame && !sinkData.prefetching) {
					this.startPrefetch({ sinkData });
				}
				return frame;
			}
		}

		const frame = await this.seekToTime({ sinkData, time });
		if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
			this.startPrefetch({ sinkData });
		}
		return frame;
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp && time < frame.timestamp + frame.duration;
	}
	private async iterateToTime({
		sinkData,
		targetTime,
	}: {
		sinkData: VideoSinkData;
		targetTime: number;
	}): Promise<WrappedCanvas | null> {
		if (!sinkData.iterator) return null;

		try {
			while (true) {
				// Wait for any pending prefetch to finish before touching iterator
				if (sinkData.prefetching && sinkData.prefetchPromise) {
					await sinkData.prefetchPromise;
				}

				// Check if the nextFrame (which might have just arrived) is what we need
				if (
					sinkData.nextFrame &&
					sinkData.nextFrame.timestamp <= targetTime + 0.05 // Tolerance
				) {
					sinkData.currentFrame = sinkData.nextFrame;
					sinkData.nextFrame = null;
				} else {
					const { value: frame, done } = await sinkData.iterator.next();

					if (done || !frame) break;

					sinkData.currentFrame = frame;
				}

				const frame = sinkData.currentFrame;
				if (!frame) break;

				sinkData.lastTime = frame.timestamp;

				if (this.isFrameValid({ frame, time: targetTime })) {
					return frame;
				}

				if (frame.timestamp > targetTime + 1.0) break;
			}
		} catch (error) {
			console.warn("Iterator failed, will restart:", error);
			sinkData.iterator = null;
		}

		return null;
	}

	private fileSignature({ file }: { file: File }): string {
		return `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
	}

	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
			}

			if (sinkData.iterator) {
				await sinkData.iterator.return();
				sinkData.iterator = null;
			}

			sinkData.nextFrame = null;
			sinkData.iterator = sinkData.sink.canvases(time);
			sinkData.lastTime = time;

			// Fetch current frame
			const { value: frame } = await sinkData.iterator.next();

			if (frame) {
				sinkData.currentFrame = frame;

				// Aggressively fetch next frame immediately to fill buffer
				// This matches the mediaplayer example which fetches 2 frames on start
				try {
					const { value: next } = await sinkData.iterator.next();
					if (next) {
						sinkData.nextFrame = next;
					}
				} catch (e) {
					console.warn("Failed to pre-fetch next frame on seek:", e);
				}

				return frame;
			}
		} catch (error) {
			console.warn("Failed to seek video:", error);
		}

		return null;
	}

	private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
		if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) {
			return;
		}

		sinkData.prefetching = true;
		sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: VideoSinkData;
	}): Promise<void> {
		if (!sinkData.iterator) {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			return;
		}

		try {
			const { value: frame, done } = await sinkData.iterator.next();

			if (done || !frame) {
				sinkData.prefetching = false;
				sinkData.prefetchPromise = null;
				return;
			}

			sinkData.nextFrame = frame;
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		} catch (error) {
			console.warn("Prefetch failed:", error);
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			sinkData.iterator = null;
		}
	}
	private async ensureSink({
		mediaId,
		file,
		alpha,
	}: {
		mediaId: string;
		file: File;
		alpha?: boolean;
	}): Promise<void> {
		if (this.sinks.has(mediaId)) return;

		if (this.initPromises.has(mediaId)) {
			await this.initPromises.get(mediaId);
			return;
		}

		const initPromise = this.initializeSink({ mediaId, file, alpha });
		this.initPromises.set(mediaId, initPromise);

		try {
			await initPromise;
		} finally {
			this.initPromises.delete(mediaId);
		}
	}
	private async initializeSink({
		mediaId,
		file,
		alpha,
	}: {
		mediaId: string;
		file: File;
		alpha?: boolean;
	}): Promise<void> {
		let input: Input | null = null;
		try {
			input = new Input({
				source: new BlobSource(file),
				formats: ALL_FORMATS,
			});

			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) {
				throw new Error("No video track found");
			}

			const canDecode = await videoTrack.canDecode();
			if (!canDecode) {
				throw new Error("Video codec not supported for decoding");
			}

			// Alpha decoding (double-decoder + WebGL merge) is opt-in per media:
			// MG overlays need transparency, plain B-roll/main video stay on the
			// cheaper single-decode path. CanvasSink.alpha defaults to false.
			const sink = new CanvasSink(videoTrack, {
				poolSize: 3,
				fit: "contain",
				alpha: alpha ?? false,
			});

			this.sinks.set(mediaId, {
				input,
				sink,
				iterator: null,
				currentFrame: null,
				nextFrame: null,
				lastTime: -1,
				prefetching: false,
				prefetchPromise: null,
			});
		} catch (error) {
			input?.dispose();
			console.error(`Failed to initialize video sink for ${mediaId}:`, error);
			throw error;
		}
	}

	private disposeSink({ mediaId }: { mediaId: string }): void {
		const sinkData = this.sinks.get(mediaId);
		if (!sinkData) return;

		if (sinkData.iterator) {
			void sinkData.iterator.return();
			sinkData.iterator = null;
		}
		sinkData.input.dispose();
		sinkData.currentFrame = null;
		sinkData.nextFrame = null;
		this.sinks.delete(mediaId);
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		this.frameRequestGenerations.set(
			mediaId,
			(this.frameRequestGenerations.get(mediaId) ?? 0) + 1,
		);
		this.disposeSink({ mediaId });
		this.initPromises.delete(mediaId);
		this.failedSignatures.delete(mediaId);
	}

	clearAll(): void {
		const mediaIds = new Set([
			...this.sinks.keys(),
			...this.initPromises.keys(),
			...this.frameRequestTails.keys(),
		]);
		for (const mediaId of mediaIds) {
			this.clearVideo({ mediaId });
		}
	}

	getStats() {
		return {
			totalSinks: this.sinks.size,
			activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
				.length,
			cachedFrames: Array.from(this.sinks.values()).filter(
				(s) => s.currentFrame,
			).length,
		};
	}
}

export const videoCache = new VideoCache();
