"use client";

import { useEditor } from "@editor/hooks/use-editor";
import { Button } from "@editor/components/ui/button";
import {
	FullScreenIcon,
	GridTableIcon,
	PauseIcon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getGuideById } from "@editor/lib/guides";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectSeparator,
} from "@editor/components/ui/select";
import { PREVIEW_ZOOM_PRESETS } from "@editor/constants/editor-constants";
import { usePreviewViewport } from "./preview-viewport";
import { GridPopover } from "./guide-popover";
import { usePreviewStore } from "@editor/stores/preview-store";

export function PreviewToolbar({
	onToggleFullscreen,
	showPlaybackButton,
}: {
	onToggleFullscreen: () => void;
	showPlaybackButton: boolean;
}) {
	return (
		<>
			<div
				className={`preview-play-button pointer-events-auto absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150 ${
					showPlaybackButton ? "opacity-100" : "opacity-0"
				}`}
			>
				<PlayPauseButton />
			</div>
			<div className="pointer-events-auto absolute bottom-4 right-4 z-30">
				<PreviewUtilityControls onToggleFullscreen={onToggleFullscreen} />
			</div>
		</>
	);
}

function PreviewUtilityControls({
	onToggleFullscreen,
}: {
	onToggleFullscreen: () => void;
}) {
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const activeGuideDefinition = getGuideById(activeGuide);

	return (
		<div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
			<ZoomSelect />
			<GridPopover>
				<Button
					variant={activeGuideDefinition ? "secondary" : "text"}
					size="icon"
					className="size-7 rounded-full bg-transparent text-[#1f2b24] hover:bg-white/80"
				>
					{activeGuideDefinition ? (
						activeGuideDefinition.renderTriggerIcon()
					) : (
						<HugeiconsIcon icon={GridTableIcon} />
					)}
				</Button>
			</GridPopover>
			<Button
				variant="text"
				size="icon"
				onClick={onToggleFullscreen}
				className="size-7 rounded-full bg-transparent text-[#1f2b24] hover:bg-white/80"
			>
				<HugeiconsIcon icon={FullScreenIcon} />
			</Button>
		</div>
	);
}

function ZoomSelect() {
	const { isAtFit, zoomPercent, fitToScreen, setViewportPercent } =
		usePreviewViewport();

	const displayLabel = isAtFit ? "Fit" : `${zoomPercent}%`;

	const onValueChange = (value: string) => {
		if (value === "fit") {
			fitToScreen();
		} else {
			setViewportPercent({ percent: Number(value) });
		}
	};

	return (
		<Select
			value={isAtFit ? "fit" : String(zoomPercent)}
			onValueChange={onValueChange}
		>
			<SelectTrigger
				variant="outline"
				className="h-7 rounded-full border-transparent bg-transparent px-2.5 text-[11px] font-medium text-[#1f2b24] tabular-nums shadow-none hover:bg-white/80"
			>
				{displayLabel}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="fit">Fit</SelectItem>
				<SelectSeparator />
				{PREVIEW_ZOOM_PRESETS.map((preset) => (
					<SelectItem key={preset} value={String(preset)}>
						{preset}%
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function PlayPauseButton() {
	const editor = useEditor();
	const isPlaying = useEditor((e) => e.playback.getIsPlaying());

	return (
		<Button
			variant="outline"
			size="icon"
			aria-label={isPlaying ? "暂停预览" : "播放预览"}
			onClick={() => editor.playback.toggle()}
			className="pointer-events-auto size-8 rounded-full border-[#d7ded7] bg-white/92 text-[#1f2b24] shadow-[0_10px_24px_rgba(21,32,27,0.12)] backdrop-blur-md hover:bg-[#f5f7f4]"
		>
			<HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} />
		</Button>
	);
}
