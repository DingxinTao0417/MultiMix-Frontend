export function assertDecodedVideoFrame<T>({
	frame,
	mediaId,
	time,
}: {
	frame: T | null;
	mediaId: string;
	time: number;
}): T {
	if (!frame) {
		throw new Error(
			`Video frame unavailable during export (media ${mediaId}, time ${time.toFixed(3)}s)`,
		);
	}
	return frame;
}
