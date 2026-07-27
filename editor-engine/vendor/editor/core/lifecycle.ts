type DisposableEditorResources = {
	playback: {
		pause(): void;
	};
	renderer: {
		setRenderTree({ renderTree }: { renderTree: null }): void;
	};
	audio: {
		dispose(): void;
	};
	media: {
		clearAllAssets(): void;
	};
	save: {
		stop(): void;
	};
};

export function disposeEditorResources(
	editor: DisposableEditorResources,
): void {
	editor.playback.pause();
	editor.renderer.setRenderTree({ renderTree: null });
	editor.audio.dispose();
	editor.media.clearAllAssets();
	editor.save.stop();
}
