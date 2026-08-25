import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertAudioBufferForExport,
  resolveBrowserExportFormat,
} from "./scene-exporter";

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
