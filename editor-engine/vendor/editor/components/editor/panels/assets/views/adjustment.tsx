"use client";

import { useCallback, useState } from "react";
import { PanelView } from "@editor/components/editor/panels/assets/views/base-panel";
import { Button } from "@editor/components/ui/button";
import { useEditor } from "@editor/hooks/use-editor";
import { UpdateElementCommand } from "@editor/lib/commands/timeline/element/update-element";
import { isVisualElement } from "@editor/lib/timeline/element-utils";

interface AdjustmentValues {
	brightness: number;
	contrast: number;
	saturate: number;
	blur: number;
}

const DEFAULT_ADJUSTMENT: AdjustmentValues = {
	brightness: 100,
	contrast: 100,
	saturate: 100,
	blur: 0,
};

const LABELS: Record<keyof AdjustmentValues, string> = {
	brightness: "Brightness",
	contrast: "Contrast",
	saturate: "Saturation",
	blur: "Blur",
};

export function AdjustmentView() {
	const editor = useEditor();
	const [values, setValues] = useState<AdjustmentValues>(DEFAULT_ADJUSTMENT);

	const applyAdjustment = useCallback(
		(next: AdjustmentValues) => {
			setValues(next);
			const selected = editor.selection.getSelectedElements();
			if (!selected.length) return;

			const isDefault =
				next.brightness === 100 &&
				next.contrast === 100 &&
				next.saturate === 100 &&
				next.blur === 0;

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
							adjustment: isDefault ? undefined : next,
						},
					}),
				});
			}
		},
		[editor],
	);

	const updateValue = useCallback(
		(key: keyof AdjustmentValues, value: number) => {
			applyAdjustment({ ...values, [key]: value });
		},
		[applyAdjustment, values],
	);

	const reset = useCallback(() => {
		applyAdjustment(DEFAULT_ADJUSTMENT);
	}, [applyAdjustment]);

	return (
		<PanelView title="Adjustment">
			<div className="flex flex-col gap-4">
				{(Object.keys(LABELS) as Array<keyof AdjustmentValues>).map((key) => (
					<div key={key} className="flex flex-col gap-1">
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>{LABELS[key]}</span>
							<span>{values[key]}</span>
						</div>
						<input
							type="range"
								min={key === "blur" ? 0 : key === "brightness" || key === "contrast" ? 10 : 0}
							max={key === "blur" ? 10 : 200}
							value={values[key]}
							onChange={(e) => updateValue(key, Number(e.target.value))}
							className="w-full accent-foreground"
						/>
					</div>
				))}
				<Button variant="outline" className="mt-2 w-full" onClick={reset}>
					Reset
				</Button>
			</div>
		</PanelView>
	);
}
