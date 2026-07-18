"use client";

import { useCallback } from "react";
import { PanelView } from "@editor/components/editor/panels/assets/views/base-panel";
import { Button } from "@editor/components/ui/button";
import { useEditor } from "@editor/hooks/use-editor";
import { UpdateElementCommand } from "@editor/lib/commands/timeline/element/update-element";
import { isVisualElement } from "@editor/lib/timeline/element-utils";

const TRANSITION_PRESETS = [
	{ type: "none", label: "None", duration: 0 },
	{ type: "fade", label: "Fade", duration: 0.5 },
	{ type: "dissolve", label: "Dissolve", duration: 0.5 },
	{ type: "slide_left", label: "Slide Left", duration: 0.5 },
	{ type: "slide_right", label: "Slide Right", duration: 0.5 },
];

export function TransitionsView() {
	const editor = useEditor();

	const applyTransition = useCallback(
		(transition: { type: string; duration: number }) => {
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
							transition: transition.type === "none" ? undefined : transition,
						},
					}),
				});
			}
		},
		[editor],
	);

	return (
		<PanelView title="Transitions">
			<div className="grid gap-2">
				{TRANSITION_PRESETS.map((preset) => (
					<Button
						key={preset.type}
						variant="outline"
						className="w-full justify-start"
						onClick={() => applyTransition(preset)}
					>
						{preset.label}
					</Button>
				))}
			</div>
		</PanelView>
	);
}
