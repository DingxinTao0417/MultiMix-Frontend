import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import { BaseNode } from "./base-node";
import { computeFitScale, type FitMode } from "./fit-scale";
import type { Effect } from "@editor/lib/effects/types";
import type { Mask } from "@editor/lib/masks/types";
import type { BlendMode, Transform } from "@editor/lib/rendering";
import type { ElementAnimations } from "@editor/lib/animation/types";
import type { RetimeConfig } from "@editor/lib/timeline";
import {
	getElementLocalTime,
	resolveOpacityAtTime,
	resolveTransformAtTime,
} from "@editor/lib/animation";
import { resolveEffectParamsAtTime } from "@editor/lib/animation/effect-param-channel";
import { TIME_EPSILON_SECONDS } from "@editor/constants/animation-constants";
import { effectsRegistry, resolveEffectPasses } from "@editor/lib/effects";
import { masksRegistry } from "@editor/lib/masks";
import { getSourceTimeAtClipTime } from "@editor/lib/retime";
import { webglEffectRenderer } from "../webgl/webgl-effect-renderer";
import { applyMaskFeather } from "../mask-feather";

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	transform: Transform;
	animations?: ElementAnimations;
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
	fitMode?: FitMode;
	filter?: string;
	adjustment?: {
		brightness: number;
		contrast: number;
		saturate: number;
		blur: number;
	};
	transition?: {
		type: string;
		duration: number;
	};
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
> extends BaseNode<Params> {
	protected getSourceLocalTime({ time }: { time: number }): number {
		const clipTime = time - this.params.timeOffset;
		return (
			this.params.trimStart +
			getSourceTimeAtClipTime({
				clipTime,
				retime: this.params.retime,
			})
		);
	}

	protected getAnimationLocalTime({ time }: { time: number }): number {
		return getElementLocalTime({
			timelineTime: time,
			elementStartTime: this.params.timeOffset,
			elementDuration: this.params.duration,
		});
	}

	protected isInRange({ time }: { time: number }): boolean {
		const localTime = time - this.params.timeOffset;
		return (
			localTime >= -TIME_EPSILON_SECONDS &&
			localTime < this.params.duration
		);
	}

	protected renderVisual({
		renderer,
		source,
		sourceWidth,
		sourceHeight,
		timelineTime,
	}: {
		renderer: CanvasRenderer;
		source: CanvasImageSource;
		sourceWidth: number;
		sourceHeight: number;
		timelineTime: number;
	}): void {
		renderer.context.save();

		const animationLocalTime = this.getAnimationLocalTime({
			time: timelineTime,
		});
		const baseTransform = this.params.transform;
		const baseOpacity = this.params.opacity;
		const transition = this.params.transition;
		const localTime = timelineTime - this.params.timeOffset;
		const transitionDuration = transition?.duration ?? 0;
		const hasTransition = transition && transition.type !== "none" && transitionDuration > 0;
		const transitionProgress = hasTransition
			? Math.min(1, Math.max(0, localTime / transitionDuration))
			: 1;

		let transitionOpacityMultiplier = 1;
		let transitionOffsetX = 0;
		if (hasTransition && transitionProgress < 1) {
			if (transition.type === "fade" || transition.type === "dissolve") {
				transitionOpacityMultiplier = transitionProgress;
			}
			if (transition.type === "slide_left") {
				transitionOpacityMultiplier = transitionProgress;
				transitionOffsetX = -renderer.width * (1 - transitionProgress);
			}
			if (transition.type === "slide_right") {
				transitionOpacityMultiplier = transitionProgress;
				transitionOffsetX = renderer.width * (1 - transitionProgress);
			}
		}

		const transform = resolveTransformAtTime({
			baseTransform: {
				...baseTransform,
				position: {
					x: baseTransform.position.x + transitionOffsetX,
					y: baseTransform.position.y,
				},
			},
			animations: this.params.animations,
			localTime: animationLocalTime,
		});
		const animatedOpacity = resolveOpacityAtTime({
			baseOpacity: baseOpacity,
			animations: this.params.animations,
			localTime: animationLocalTime,
		});
		const fitScale = computeFitScale(
			renderer.width,
			renderer.height,
			sourceWidth,
			sourceHeight,
			this.params.fitMode,
		);
		const scaledWidth = sourceWidth * fitScale * transform.scaleX;
		const scaledHeight = sourceHeight * fitScale * transform.scaleY;
		const absWidth = Math.abs(scaledWidth);
		const absHeight = Math.abs(scaledHeight);
		const x = renderer.width / 2 + transform.position.x - absWidth / 2;
		const y = renderer.height / 2 + transform.position.y - absHeight / 2;

		renderer.context.globalCompositeOperation = (
			this.params.blendMode && this.params.blendMode !== "normal"
				? this.params.blendMode
				: "source-over"
		) as GlobalCompositeOperation;
		renderer.context.globalAlpha = animatedOpacity * transitionOpacityMultiplier;
		renderer.context.filter = this.buildCanvasFilter();

		const flipX = scaledWidth < 0 ? -1 : 1;
		const flipY = scaledHeight < 0 ? -1 : 1;
		const needsTransform = transform.rotate !== 0 || flipX !== 1 || flipY !== 1;

		if (needsTransform) {
			const centerX = x + absWidth / 2;
			const centerY = y + absHeight / 2;
			renderer.context.translate(centerX, centerY);
			renderer.context.rotate((transform.rotate * Math.PI) / 180);
			renderer.context.scale(flipX, flipY);
			renderer.context.translate(-centerX, -centerY);
		}

		const enabledEffects =
			this.params.effects?.filter((effect) => effect.enabled) ?? [];
		const activeMasks = this.params.masks ?? [];

		if (activeMasks.length === 0 && enabledEffects.length === 0) {
			renderer.context.drawImage(source, x, y, absWidth, absHeight);
			renderer.context.restore();
			return;
		}

		const currentResult =
			enabledEffects.length > 0
				? this.applyEffects({
						source,
						effects: enabledEffects,
						width: absWidth,
						height: absHeight,
						animationLocalTime,
					})
				: source;

		if (activeMasks.length === 0) {
			renderer.context.drawImage(currentResult, x, y, absWidth, absHeight);
			renderer.context.restore();
			return;
		}

		const elementCanvas = createOffscreenCanvas({
			width: Math.round(absWidth),
			height: Math.round(absHeight),
		});
		const elementCtx = elementCanvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!elementCtx) {
			renderer.context.drawImage(currentResult, x, y, absWidth, absHeight);
			renderer.context.restore();
			return;
		}

		elementCtx.drawImage(currentResult, 0, 0, absWidth, absHeight);

		for (const mask of activeMasks) {
			this.applyMask({
				mask,
				elementCtx,
				scaledWidth: absWidth,
				scaledHeight: absHeight,
			});
		}

		renderer.context.drawImage(elementCanvas, x, y, absWidth, absHeight);
		renderer.context.restore();
	}

	private buildCanvasFilter(): string {
		const adjustment = this.params.adjustment;
		const filter = this.params.filter;
		const parts: string[] = [];
		if (filter) {
			parts.push(filter);
		}
		if (adjustment) {
			const { brightness, contrast, saturate, blur } = adjustment;
			if (brightness !== 100) {
				parts.push(`brightness(${brightness}%)`);
			}
			if (contrast !== 100) {
				parts.push(`contrast(${contrast}%)`);
			}
			if (saturate !== 100) {
				parts.push(`saturate(${saturate}%)`);
			}
			if (blur > 0) {
				parts.push(`blur(${blur}px)`);
			}
		}
		return parts.join(" ") || "none";
	}

	private applyEffects({
		source,
		effects,
		width,
		height,
		animationLocalTime,
	}: {
		source: CanvasImageSource;
		effects: Effect[];
		width: number;
		height: number;
		animationLocalTime: number;
	}): CanvasImageSource {
		let current: CanvasImageSource = source;
		for (const effect of effects) {
			const resolvedParams = resolveEffectParamsAtTime({
				effect,
				animations: this.params.animations,
				localTime: animationLocalTime,
			});
			const definition = effectsRegistry.get(effect.type);
			const passes = resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width,
				height,
			});
			current = webglEffectRenderer.applyEffect({
				source: current,
				width: Math.round(width),
				height: Math.round(height),
				passes,
			});
		}
		return current;
	}

	private applyMask({
		mask,
		elementCtx,
		scaledWidth,
		scaledHeight,
	}: {
		mask: Mask;
		elementCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
		scaledWidth: number;
		scaledHeight: number;
	}): void {
		const definition = masksRegistry.get(mask.type);
		const { feather, inverted } = mask.params;

		const maskCanvas = createOffscreenCanvas({
			width: Math.round(scaledWidth),
			height: Math.round(scaledHeight),
		});
		const maskCtx = maskCanvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!maskCtx) return;

		maskCtx.clearRect(0, 0, scaledWidth, scaledHeight);

		let maskResult: CanvasImageSource = maskCanvas;
		let path: Path2D | null = null;

		if (feather > 0 && definition.renderer.renderMask) {
			// Bypasses JFA — avoids the two-sided distance artifact where strips
			// near the canvas edge appear semi-transparent.
			definition.renderer.renderMask({
				resolvedParams: mask.params,
				ctx: maskCtx,
				width: Math.round(scaledWidth),
				height: Math.round(scaledHeight),
				feather,
			});
		} else {
			path = definition.renderer.buildPath({
				resolvedParams: mask.params,
				width: scaledWidth,
				height: scaledHeight,
			});
			maskCtx.fillStyle = "white";
			maskCtx.fill(path);

			if (feather > 0) {
				maskResult = applyMaskFeather({
					maskCanvas,
					width: Math.round(scaledWidth),
					height: Math.round(scaledHeight),
					feather,
				});
			}
		}

		elementCtx.globalCompositeOperation = inverted
			? "destination-out"
			: "destination-in";
		elementCtx.drawImage(maskResult, 0, 0, scaledWidth, scaledHeight);
		elementCtx.globalCompositeOperation = "source-over";

		const strokePath =
			definition.renderer.buildStrokePath?.({
				resolvedParams: mask.params,
				width: scaledWidth,
				height: scaledHeight,
			}) ?? path;

		if (mask.params.strokeWidth > 0 && strokePath) {
			elementCtx.strokeStyle = mask.params.strokeColor;
			elementCtx.lineWidth = mask.params.strokeWidth;
			elementCtx.stroke(strokePath);
		}
	}
}
