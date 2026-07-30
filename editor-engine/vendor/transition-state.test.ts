import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@editor/lib/animation", () => ({
  getElementLocalTime: ({ timelineTime, elementStartTime, elementDuration }: {
    timelineTime: number;
    elementStartTime: number;
    elementDuration: number;
  }) => Math.min(elementDuration, Math.max(0, timelineTime - elementStartTime)),
  resolveOpacityAtTime: ({ baseOpacity }: { baseOpacity: number }) => baseOpacity,
  resolveTransformAtTime: ({ baseTransform }: { baseTransform: unknown }) => baseTransform,
}));
vi.mock("@editor/lib/animation/effect-param-channel", () => ({
  resolveEffectParamsAtTime: ({ effect }: { effect: unknown }) => effect,
}));
vi.mock("@editor/constants/animation-constants", () => ({
  TIME_EPSILON_SECONDS: 0.000001,
}));
vi.mock("@editor/lib/effects", () => ({
  effectsRegistry: { get: vi.fn() },
  resolveEffectPasses: vi.fn(() => []),
}));
vi.mock("@editor/lib/masks", () => ({
  masksRegistry: { get: vi.fn() },
}));
vi.mock("@editor/lib/retime", () => ({
  getSourceTimeAtClipTime: ({ clipTime }: { clipTime: number }) => clipTime,
}));
vi.mock("./editor/services/renderer/webgl/webgl-effect-renderer", () => ({
  webglEffectRenderer: { apply: vi.fn() },
}));
vi.mock("./editor/services/renderer/mask-feather", () => ({
  applyMaskFeather: vi.fn(),
}));
vi.mock("@editor/lib/timeline", () => ({
  isMainTrack: (track: { type: string; isMain?: boolean }) =>
    track.type === "video" && track.isMain === true,
}));
vi.mock("@editor/constants/project-constants", () => ({
  DEFAULT_BLUR_INTENSITY: 20,
}));
vi.mock("./editor/services/renderer/nodes/root-node", () => ({
  RootNode: class {
    params: unknown;
    children: Array<{ params: Record<string, unknown> }> = [];
    constructor(params: unknown) { this.params = params; }
    add(node: { params: Record<string, unknown> }) { this.children.push(node); return this; }
  },
}));
vi.mock("./editor/services/renderer/nodes/video-node", () => ({
  VideoNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/image-node", () => ({
  ImageNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/text-node", () => ({
  TextNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/sticker-node", () => ({
  StickerNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/graphic-node", () => ({
  GraphicNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/color-node", () => ({
  ColorNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/blur-background-node", () => ({
  BlurBackgroundNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));
vi.mock("./editor/services/renderer/nodes/effect-layer-node", () => ({
  EffectLayerNode: class {
    params: Record<string, unknown>;
    constructor(params: Record<string, unknown>) { this.params = params; }
  },
}));

import type { CanvasRenderer } from "./editor/services/renderer/canvas-renderer";
import { buildScene } from "./editor/services/renderer/scene-builder";
import {
  normalizeVisualTransition,
  resolveIncomingBoundaryTransition,
  resolveOutgoingBoundaryTransition,
} from "./editor/services/renderer/transition-state";
import {
  VisualNode,
  type VisualNodeParams,
} from "./editor/services/renderer/nodes/visual-node";

type Transition = { type: string; duration: number };
type TestVisualNodeParams = VisualNodeParams & {
  outgoingTransition?: Transition;
};

class TestVisualNode extends VisualNode<TestVisualNodeParams> {
  inRange(time: number): boolean {
    return this.isInRange({ time });
  }

  sourceTime(time: number): number {
    return this.getSourceLocalTime({ time });
  }

  drawAt(renderer: CanvasRenderer, time: number): void {
    this.renderVisual({
      renderer,
      source: {} as CanvasImageSource,
      sourceWidth: 100,
      sourceHeight: 50,
      timelineTime: time,
    });
  }
}

function makeNode(overrides: Partial<TestVisualNodeParams> = {}): TestVisualNode {
  return new TestVisualNode({
    duration: 4,
    timeOffset: 0,
    trimStart: 0,
    trimEnd: 0,
    transform: {
      scaleX: 1,
      scaleY: 1,
      position: { x: 0, y: 0 },
      rotate: 0,
    },
    opacity: 1,
    ...overrides,
  });
}

function makeRenderer() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    filter: "none",
  };
  return {
    context,
    renderer: {
      width: 100,
      height: 50,
      context,
    } as unknown as CanvasRenderer,
  };
}

describe("visual scene transition state", () => {
  it("keeps wipe available in the manual transition panel", () => {
    const source = readFileSync(
      new URL(
        "./editor/components/editor/panels/assets/views/transitions.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain('{ type: "wipe_left", label: "Wipe", duration: 0.5 }');
  });

  it("rejects unknown transition types and invalid durations", () => {
    expect(normalizeVisualTransition({ type: "spin_away", duration: 0.5 }, 1))
      .toBeUndefined();
    expect(normalizeVisualTransition({ type: "dissolve", duration: 0 }, 1))
      .toBeUndefined();
  });

  it("keeps the outgoing visual renderable for the next dissolve window", () => {
    const node = makeNode({
      outgoingTransition: { type: "dissolve", duration: 0.5 },
    });

    expect(node.inRange(4.25)).toBe(true);
    expect(node.inRange(4.5)).toBe(false);
  });

  it("holds the outgoing video on its last valid source frame", () => {
    const node = makeNode({
      outgoingTransition: { type: "dissolve", duration: 0.5 },
    });

    expect(node.sourceTime(4.25)).toBeLessThan(4);
    expect(node.sourceTime(4.25)).toBeGreaterThan(3.99);
  });

  it("moves an outgoing visual left while a slide-right scene enters", () => {
    const node = makeNode({
      outgoingTransition: { type: "slide_right", duration: 0.5 },
    });
    const { context, renderer } = makeRenderer();

    node.drawAt(renderer, 4.25);

    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      -50,
      0,
      100,
      50,
    );
  });

  it("reveals an incoming wipe through a canvas clip", () => {
    const node = makeNode({
      transition: { type: "wipe_left", duration: 0.5 },
    });
    const { context, renderer } = makeRenderer();

    node.drawAt(renderer, 0.25);

    expect(context.beginPath).toHaveBeenCalledOnce();
    expect(context.rect).toHaveBeenCalledWith(0, 0, 50, 50);
    expect(context.clip).toHaveBeenCalledOnce();
  });

  it("gives contiguous main-track neighbors one shared boundary window", () => {
    const root = buildScene({
      canvasSize: { width: 100, height: 50 },
      duration: 4.6,
      background: { type: "color", color: "transparent" },
      tracks: [{
        id: "track-video",
        name: "素材",
        type: "video",
        isMain: true,
        muted: false,
        hidden: false,
        elements: [
          {
            id: "scene-a",
            name: "A",
            type: "image",
            mediaId: "media-a",
            startTime: 0,
            duration: 0.6,
            trimStart: 0,
            trimEnd: 0,
            transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 },
            opacity: 1,
          },
          {
            id: "scene-b",
            name: "B",
            type: "image",
            mediaId: "media-b",
            startTime: 0.6,
            duration: 4,
            trimStart: 0,
            trimEnd: 0,
            transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 },
            opacity: 1,
            transition: { type: "dissolve", duration: 0.5 },
          },
        ],
      }],
      mediaAssets: [
        { id: "media-a", type: "image", name: "A", file: {} as File, url: "memory://a" },
        { id: "media-b", type: "image", name: "B", file: {} as File, url: "memory://b" },
      ],
    });
    const nodes = (root as unknown as {
      children: Array<{ params: Record<string, unknown> }>;
    }).children;

    expect(nodes[0].params.outgoingTransition).toEqual({
      type: "dissolve",
      duration: 0.3,
    });
    expect(nodes[1].params.transition).toEqual({
      type: "dissolve",
      duration: 0.3,
    });
  });

  it("does not extend overlays or main-track gaps into an outgoing window", () => {
    const elements = [
      { type: "image", startTime: 0, duration: 1 },
      {
        type: "image",
        startTime: 2,
        duration: 2,
        transition: { type: "dissolve", duration: 0.5 },
      },
    ];

    expect(resolveOutgoingBoundaryTransition(elements, 0, true)).toBeUndefined();
    expect(resolveOutgoingBoundaryTransition(elements, 0, false)).toBeUndefined();
    expect(resolveIncomingBoundaryTransition(elements, 1, false)).toEqual({
      type: "dissolve",
      duration: 0.5,
    });
  });
});
