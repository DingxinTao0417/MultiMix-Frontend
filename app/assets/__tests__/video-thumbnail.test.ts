// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVideoThumbnail } from "../lib/video-thumbnail";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("video thumbnail decoding", () => {
  function media() {
    const videos: HTMLVideoElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const element = createElement(tag);
      if (tag === "video") {
        Object.defineProperties(element, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 },
          duration: { value: 3 }, readyState: { value: 2 } });
        videos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,frame");
    return { videos, draw };
  }
  it("decodes and releases a real frame without playback", async () => {
    const { videos, draw } = media();
    const promise = readVideoThumbnail("https://media.example/real.mp4", new AbortController().signal);
    expect(videos).toHaveLength(1);
    expect(videos[0].crossOrigin).toBe("anonymous");
    videos[0].dispatchEvent(new Event("loadeddata"));
    await expect(promise).resolves.toBe("data:image/jpeg;base64,frame");
    expect(draw).toHaveBeenCalledWith(videos[0], 0, 0, 640, 360);
    expect(videos[0].hasAttribute("src")).toBe(false);
  });
  it("limits active decoders and releases cancelled work", async () => {
    const { videos } = media();
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const promises = controllers.map((controller, i) => readVideoThumbnail(`https://media.example/limit-${i}.mp4`, controller.signal));
    const settled = Promise.allSettled(promises);
    expect(videos).toHaveLength(2);
    controllers[0].abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(videos).toHaveLength(3);
    controllers.slice(1).forEach((controller) => controller.abort());
    expect((await settled).every((result) => result.status === "rejected")).toBe(true);
    expect(videos.every((video) => !video.hasAttribute("src"))).toBe(true);
  });
  it("cancels queued work before a decoder is allocated", async () => {
    const { videos } = media();
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const promises = controllers.map((controller, i) => readVideoThumbnail(`https://media.example/queue-${i}.mp4`, controller.signal));
    const settled = Promise.allSettled(promises);
    controllers[2].abort();
    controllers.slice(0, 2).forEach((controller) => controller.abort());
    await settled;
    expect(videos).toHaveLength(2);
  });
  it("times out unreadable media and frees the decoder", async () => {
    vi.useFakeTimers();
    const { videos } = media();
    const promise = readVideoThumbnail("https://media.example/stalled.mp4", new AbortController().signal);
    const assertion = expect(promise).rejects.toThrow("Video thumbnail timed out");
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(videos[0].hasAttribute("src")).toBe(false);
  });
});
