import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./nodes/effect-layer-node", () => ({
  EffectLayerNode: class EffectLayerNode {},
}));
vi.mock("./mask-feather", () => ({ applyMaskFeather: vi.fn() }));
vi.mock("@editor/lib/effects", () => ({
  effectsRegistry: { get: vi.fn() },
  resolveEffectPasses: vi.fn(() => []),
}));
vi.mock("@editor/lib/effects/definitions/blur", () => ({
  buildGaussianBlurPasses: vi.fn(() => []),
}));
vi.mock("./webgl/webgl-effect-renderer", () => ({
  webglEffectRenderer: { apply: vi.fn() },
}));

import {
  assertAudioBufferForExport,
  resolveBrowserExportFormat,
} from "./scene-exporter";
import { buildScene } from "./scene-builder";
import { buildProject, type BackendProject } from "../../../buildProject";

const originalAudioEncoder = globalThis.AudioEncoder;

afterEach(() => {
  Object.defineProperty(globalThis, "AudioEncoder", {
    configurable: true,
    value: originalAudioEncoder,
  });
});

describe("resolveBrowserExportFormat", () => {
  it("uses a truthful WebM candidate when the browser cannot encode AAC", async () => {
    Object.defineProperty(globalThis, "AudioEncoder", {
      configurable: true,
      value: {
        isConfigSupported: vi.fn().mockResolvedValue({ supported: false }),
      },
    });

    await expect(resolveBrowserExportFormat({
      requestedFormat: "mp4",
      includeAudio: true,
      audioBuffer: { sampleRate: 48_000, numberOfChannels: 2 } as AudioBuffer,
    })).resolves.toBe("webm");
  });

  it("keeps MP4 when AAC is supported", async () => {
    Object.defineProperty(globalThis, "AudioEncoder", {
      configurable: true,
      value: {
        isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
      },
    });

    await expect(resolveBrowserExportFormat({
      requestedFormat: "mp4",
      includeAudio: true,
      audioBuffer: { sampleRate: 48_000, numberOfChannels: 2 } as AudioBuffer,
    })).resolves.toBe("mp4");
  });

  it("fails closed instead of encoding a video with its requested source audio missing", () => {
    expect(() => assertAudioBufferForExport({
      shouldIncludeAudio: true,
      audioBuffer: undefined,
    })).toThrow("Source audio could not be decoded");
  });
});

describe("edit decision export scene graph", () => {
  it("uses the same explicit motion, transition and information layer as preview", () => {
    const animations = {
      channels: {
        "transform.scaleX": {
          valueKind: "number" as const,
          keyframes: [
            { id: "zoom-start", time: 0, value: 1, interpolation: "linear" as const },
            { id: "zoom-end", time: 2, value: 1.08, interpolation: "linear" as const },
          ],
        },
      },
    };
    const backend: BackendProject = {
      metadata: { title: "导出共用时间线", duration: 4 },
      settings: { fps: 30, width: 1920, height: 1080 },
      media: [{ id: "m1", type: "video", file_path: "local://assets/one.mp4", name: "one.mp4" }],
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "素材",
          elements: [
            {
              id: "v1",
              type: "video",
              mediaId: "m1",
              startTime: 0,
              duration: 2,
              animations,
              transition: null,
            },
            {
              id: "v2",
              type: "video",
              mediaId: "m1",
              startTime: 2,
              duration: 2,
              animations,
              transition: { type: "dissolve", duration: 0.5 },
            },
          ],
        },
        {
          id: "track-edit-overlays",
          type: "text",
          name: "信息层",
          elements: [{
            id: "overlay-1",
            type: "text",
            content: "已确认价值",
            startTime: 0,
            duration: 4,
            textRole: "edit_overlay",
            editOverlayKind: "value",
            safeRegion: { x: 0.58, y: 0.46, width: 0.34, height: 0.16 },
          }],
        },
      ],
    };
    const { project, assets } = buildProject(backend);
    const root = buildScene({
      canvasSize: project.settings.canvasSize,
      tracks: project.scenes[0].tracks,
      mediaAssets: assets,
      duration: project.metadata.duration,
      background: project.settings.background,
      isPreview: false,
    });
    const videoNodes = root.children.filter((node) => node.constructor.name === "VideoNode");
    const textNode = root.children.find((node) => node.constructor.name === "TextNode");

    expect(videoNodes).toHaveLength(2);
    expect(videoNodes[0].params).toMatchObject({ animations });
    expect(videoNodes[1].params).toMatchObject({
      animations,
      transition: { type: "dissolve", duration: 0.5 },
    });
    expect(textNode?.params).toMatchObject({
      content: "已确认价值",
      textRole: "edit_overlay",
    });
  });
});
