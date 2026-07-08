import {
	TooltipProvider,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@editor/components/ui/tooltip";
import { Button } from "@editor/components/ui/button";
import { Slider } from "@editor/components/ui/slider";
import { TIMELINE_CONSTANTS } from "@editor/constants/timeline-constants";
import { sliderToZoom, zoomToSlider } from "@editor/lib/timeline/zoom-utils";
import { type TActionWithOptionalArgs, invokeAction } from "@editor/lib/actions";
import { cn } from "@editor/utils/ui";
import { ScrollArea } from "@editor/components/ui/scroll-area";
import {
	Delete02Icon,
	ScissorIcon,
	SearchAddIcon,
	SearchMinusIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function TimelineToolbar({
	zoomLevel,
	minZoom,
	setZoomLevel,
}: {
	zoomLevel: number;
	minZoom: number;
	setZoomLevel: ({ zoom }: { zoom: number }) => void;
}) {
	const handleZoom = ({ direction }: { direction: "in" | "out" }) => {
		const newZoomLevel =
			direction === "in"
				? Math.min(
						TIMELINE_CONSTANTS.ZOOM_MAX,
						zoomLevel * TIMELINE_CONSTANTS.ZOOM_BUTTON_FACTOR,
					)
				: Math.max(minZoom, zoomLevel / TIMELINE_CONSTANTS.ZOOM_BUTTON_FACTOR);
		setZoomLevel({ zoom: newZoomLevel });
	};

	return (
		<ScrollArea className="scrollbar-hidden">
			<div className="flex h-9 items-center justify-between gap-2 border-b border-[#eceef0] px-2.5 py-1">
				<ToolbarLeftSection />
				<div className="min-w-0 flex-1" />

				<ToolbarRightSection
					zoomLevel={zoomLevel}
					minZoom={minZoom}
					onZoomChange={(zoom) => setZoomLevel({ zoom })}
					onZoom={handleZoom}
				/>
			</div>
		</ScrollArea>
	);
}

function ToolbarLeftSection() {
	const handleAction = ({
		action,
		event,
	}: {
		action: TActionWithOptionalArgs;
		event: React.MouseEvent;
	}) => {
		event.stopPropagation();
		invokeAction(action);
	};

	return (
		<div className="flex items-center gap-1">
			<TooltipProvider delayDuration={500}>
				<ToolbarButton
					icon={<HugeiconsIcon icon={ScissorIcon} />}
					tooltip="Split clip"
					onClick={({ event }) => handleAction({ action: "split", event })}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Delete02Icon} />}
					tooltip="Delete clip"
					onClick={({ event }) =>
						handleAction({ action: "delete-selected", event })
					}
				/>
			</TooltipProvider>
		</div>
	);
}

function ToolbarRightSection({
	zoomLevel,
	minZoom,
	onZoomChange,
	onZoom,
}: {
	zoomLevel: number;
	minZoom: number;
	onZoomChange: (zoom: number) => void;
	onZoom: (options: { direction: "in" | "out" }) => void;
}) {
	return (
		<div className="flex items-center gap-1">
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="icon"
					onClick={() => onZoom({ direction: "out" })}
					className="size-7 rounded-full border-[#d7ded7] bg-white hover:bg-[#f5f7f4]"
				>
					<HugeiconsIcon icon={SearchMinusIcon} />
				</Button>
				<Slider
					className="w-20"
					value={[zoomToSlider({ zoomLevel, minZoom })]}
					onValueChange={(values) =>
						onZoomChange(sliderToZoom({ sliderPosition: values[0], minZoom }))
					}
					min={0}
					max={1}
					step={0.005}
				/>
				<Button
					variant="outline"
					size="icon"
					onClick={() => onZoom({ direction: "in" })}
					className="size-7 rounded-full border-[#d7ded7] bg-white hover:bg-[#f5f7f4]"
				>
					<HugeiconsIcon icon={SearchAddIcon} />
				</Button>
			</div>
		</div>
	);
}

function ToolbarButton({
	icon,
	tooltip,
	onClick,
	disabled,
	isActive,
}: {
	icon: React.ReactNode;
	tooltip: string;
	onClick: ({ event }: { event: React.MouseEvent }) => void;
	disabled?: boolean;
	isActive?: boolean;
}) {
	return (
		<Tooltip delayDuration={200}>
			<TooltipTrigger asChild>
				<Button
					variant={isActive ? "secondary" : "text"}
					size="icon"
					onClick={(event) => onClick({ event })}
					className={cn(
						"size-7 rounded-full border border-transparent text-[#17211d]",
						!isActive && "bg-white hover:bg-[#f5f7f4]",
						isActive && "border-[#dce6df] bg-[#edf4ef] text-[#1d6f57]",
						disabled ? "cursor-not-allowed opacity-50" : "",
					)}
				>
					{icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
