"use client";

import { useCallback } from "react";
import { PanelView } from "@editor/components/editor/panels/assets/views/base-panel";
import { Button } from "@editor/components/ui/button";
import { useEditor } from "@editor/hooks/use-editor";
import { UpdateElementCommand } from "@editor/lib/commands/timeline/element/update-element";
import { isVisualElement } from "@editor/lib/timeline/element-utils";

const FILTER_PRESETS: Record<
	string,
	{ label: string; filter: string; adjustment?: undefined }
> = {
	none: { label: "None", filter: "" },
	grayscale: { label: "Grayscale", filter: "grayscale(100%)" },
	sepia: { label: "Sepia", filter: "sepia(100%)" },
	vintage: { label: "Vintage", filter: "sepia(60%) contrast(110%) brightness(90%)" },
	cool: { label: "Cool", filter: "hue-rotate(180deg) saturate(120%)" },
	warm: { label: "Warm", filter: "hue-rotate(340deg) saturate(110%)" },
	blur: { label: "Blur", filter: "blur(4px)" },
};

export function FiltersView() {
	const editor = useEditor();

	const applyFilter = useCallback(
		(filterValue: string) => {
			const selected = editor.selection.getSelectedElements();
			if (!selected.length) return;

			const tracks = editor.timeline.getTracks();
			for (const { trackId, elementId } of selected) {
				const track = tracks.find((t) => t.id === trackId);
				const element = track?.elements.find((e) => e.id === elementId);
				if (!element || !isVisualElement(element)) continue;

				editor.command.execute({
					command: new UpdateElementCommand({
						trackId,
						elementId,
						updates: {
							filter: filterValue || undefined,
						},
					}),
				});
			}
		},
		[editor],
	);

	return (
		<PanelView title="Filters">
			<div className="grid grid-cols-2 gap-2">
				{Object.entries(FILTER_PRESETS).map(([key, preset]) => (
					<Button
						key={key}
						variant="outline"
						className="w-full justify-center"
						onClick={() => applyFilter(preset.filter)}
					>
						{preset.label}
					</Button>
				))}
			</div>
		</PanelView>
	);
}
