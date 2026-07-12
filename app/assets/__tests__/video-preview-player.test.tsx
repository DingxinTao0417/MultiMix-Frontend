// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoPreviewPlayer, { formatPreviewTime } from "../components/video-preview-player";

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

    fireEvent.click(screen.getByRole("button", { name: "点击画面播放视频" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: "暂停视频" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "播放进度" }), { target: { value: "12" } });
    expect(video.currentTime).toBe(12);
    fireEvent.timeUpdate(video);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(12);

    fireEvent.click(screen.getByRole("button", { name: "暂停视频" }));
    expect(pause).toHaveBeenCalledOnce();
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
