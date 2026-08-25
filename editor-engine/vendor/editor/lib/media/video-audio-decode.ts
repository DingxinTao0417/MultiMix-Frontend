export async function decodeVideoAudioWithNativeAudioContext({
	file,
	audioContext,
}: {
	file: Pick<File, "arrayBuffer">;
	audioContext: Pick<AudioContext, "decodeAudioData">;
}): Promise<AudioBuffer> {
	const arrayBuffer = await file.arrayBuffer();
	return await audioContext.decodeAudioData(arrayBuffer.slice(0));
}
