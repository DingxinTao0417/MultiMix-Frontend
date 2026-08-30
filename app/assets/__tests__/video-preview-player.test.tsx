// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoPreviewPlayer, { formatPreviewTime } from "../components/video-preview-player";
import { finishedVideoPosterUrl } from "../components/product-preview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("video preview player", () => {
  it("formats player time", () => {
    expect(formatPreviewTime(0)).toBe("00:00");
    expect(formatPreviewTime(65.8)).toBe("01:05");
  });

  it("plays, pauses, and seeks from the shared controls", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const onTimeUpdate = vi.fn();
    const { container } = render(
      <VideoPreviewPlayer
        src="/demo.mp4"
        label="成片播放器"
        ratioClassName="ratio-landscape"
        onTimeUpdate={onTimeUpdate}
      />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });
    fireEvent.loadedMetadata(video);
    fireEvent.canPlay(video);

    fireEvent.click(screen.getByRole("button", { name: "点击画面播放视频" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: "点击画面暂停视频" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "播放进度" }), { target: { value: "12" } });
    expect(video.currentTime).toBe(12);
    fireEvent.timeUpdate(video);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(12);

    expect(screen.queryByRole("button", { name: "暂停视频" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "点击画面暂停视频" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it("shows a poster while the finished video first frame is still loading", () => {
    const { container } = render(
      <VideoPreviewPlayer
        src="/demo.mp4"
        posterSrc="/first-scene.jpg"
        label="成片播放器"
        ratioClassName="ratio-landscape"
      />,
    );

    expect(container.querySelector("video")).toHaveAttribute("poster", "/first-scene.jpg");
  });

  it("keeps playback controls disabled until the video has a playable buffer", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(
      <VideoPreviewPlayer src="/demo.mp4" label="成片播放器" ratioClassName="ratio-landscape" />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });

    expect(screen.getByRole("status")).toHaveTextContent("正在加载视频");
    expect(screen.getByRole("button", { name: "点击画面播放视频" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeDisabled();

    fireEvent.canPlay(video);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "点击画面播放视频" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "点击画面播放视频" }));
    expect(play).toHaveBeenCalledOnce();
  });

  it("preloads the first playable buffer and keeps controls usable through later buffering", () => {
    const { container } = render(
      <VideoPreviewPlayer src="/demo.mp4" label="成片播放器" ratioClassName="ratio-landscape" />,
    );
    const video = container.querySelector("video")!;

    expect(video).toHaveAttribute("preload", "auto");
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });
    fireEvent.loadedMetadata(video);
    fireEvent.canPlay(video);
    fireEvent.waiting(video);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "点击画面播放视频" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeEnabled();
  });

  it("shows the actual buffered percentage while the video is loading", () => {
    const { container } = render(
      <VideoPreviewPlayer src="/demo.mp4" label="成片播放器" ratioClassName="ratio-landscape" />,
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });
    Object.defineProperty(video, "buffered", {
      configurable: true,
      value: { length: 1, end: () => 12 },
    });

    fireEvent.progress(video);
    expect(screen.getByRole("status")).toHaveTextContent("已缓冲 40%");
  });

  it("selects the first non-video scene thumbnail for the finished-video poster", () => {
    expect(finishedVideoPosterUrl({
      id: "video-1",
      mode: "video",
      title: "视频",
      status: "已完成",
      summary: "",
      ratio: "16:9",
      duration: "30秒",
      phase: "视频工程",
      sections: [],
      timeline: [],
      actions: [],
      segments: [
        { id: "scene-1", index: 1, assetThumbnailUrl: "/motion.mp4", primaryVisualMediaType: "video", isFallback: false },
        { id: "scene-2", index: 2, assetThumbnailUrl: "/first-scene.jpg", primaryVisualMediaType: "image", isFallback: false },
      ],
    })).toBe("/first-scene.jpg");
  });

  it("shows a recoverable error instead of an unexplained black screen", () => {
    const onError = vi.fn();
    const { container } = render(
      <VideoPreviewPlayer
        src="/broken.mp4"
        label="成片播放器"
        ratioClassName="ratio-landscape"
        onError={onError}
      />,
    );

    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByRole("alert")).toHaveTextContent("视频暂时无法加载");
    expect(screen.getByRole("button", { name: "重新加载视频" })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
  });
});
