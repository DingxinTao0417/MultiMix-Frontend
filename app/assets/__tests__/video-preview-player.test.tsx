// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    expect(play).toHaveBeenCalledOnce();
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: "成片播放器：暂停视频" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "成片播放器：播放进度" }), { target: { value: "12" } });
    expect(video.currentTime).toBe(12);
    fireEvent.timeUpdate(video);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(12);

    expect(screen.queryByRole("button", { name: "暂停视频" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "成片播放器：暂停视频" }));
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
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "成片播放器：播放进度" })).toBeDisabled();

    fireEvent.canPlay(video);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    expect(play).toHaveBeenCalledOnce();
  });

  it("recovers already loaded media without waiting for another browser load event", () => {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(30);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1920);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(1080);
    const { container } = render(<VideoPreviewPlayer src="/cached.mp4" label="成片播放器"
      ratioClassName="" initialTime={12} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeEnabled();
    expect(screen.getByRole("slider")).toBeEnabled();
    expect(screen.getByRole("slider")).toHaveAttribute("max", "30");
    expect(screen.getByText("00:30")).toBeInTheDocument();
    expect(screen.getByText("00:12")).toBeInTheDocument();
    expect(container.querySelector("video")!.currentTime).toBe(12);
    expect(screen.getByRole("group")).toHaveClass("ratio-landscape");
  });

  it("reads cached metadata and buffering without prematurely enabling playback", () => {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
    vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(30);
    vi.spyOn(HTMLMediaElement.prototype, "buffered", "get")
      .mockReturnValue({ length: 1, start: () => 0, end: () => 12 });
    render(<VideoPreviewPlayer src="/metadata.mp4" label="成片播放器" ratioClassName="ratio-landscape" />);

    expect(screen.getByText("00:30")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已缓冲 40%");
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeDisabled();
  });

  it("does not carry cached readiness or duration into a different source", () => {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(function (this: HTMLMediaElement) {
      return this.getAttribute("src") === "/cached.mp4" ? 4 : 0;
    });
    vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockImplementation(function (this: HTMLMediaElement) {
      return this.getAttribute("src") === "/cached.mp4" ? 30 : NaN;
    });
    const { rerender } = render(<VideoPreviewPlayer src="/cached.mp4" label="成片播放器" ratioClassName="ratio-landscape" />);
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeEnabled();

    rerender(<VideoPreviewPlayer src="/new.mp4" label="成片播放器" ratioClassName="ratio-landscape" />);
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeDisabled();
    expect(screen.getByRole("slider")).toHaveAttribute("max", "0");
    expect(screen.queryByText("00:30")).toBeNull();
  });

  it("shows an existing media error even if its browser event preceded hydration", () => {
    render(<VideoPreviewPlayer src="/broken.mp4" label="成片播放器" ratioClassName="ratio-landscape"
      ref={(node) => { if (node) Object.defineProperty(node, "error", { value: { code: 4 } }); }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("视频暂时无法加载");
    expect(screen.getByRole("button", { name: "成片播放器：重新加载视频" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "成片播放器：播放进度" })).toBeEnabled();
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
    expect(screen.getByRole("group", { name: "成片播放器" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "成片播放器：重新加载视频" })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not present an interrupted play request as a failed video load", async () => {
    const onError = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("Interrupted", "AbortError"));
    const { container } = render(<VideoPreviewPlayer src="/demo.mp4" label="成片播放器"
      ratioClassName="ratio-landscape" onError={onError} />);
    fireEvent.canPlay(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeEnabled());
    expect(screen.queryByText("视频暂时无法加载")).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("explains a browser playback refusal without replacing the usable player", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("Blocked", "NotAllowedError"));
    const { container } = render(<VideoPreviewPlayer src="/demo.mp4" label="成片播放器"
      ratioClassName="ratio-landscape" />);
    fireEvent.canPlay(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    expect(await screen.findByRole("status")).toHaveTextContent("浏览器阻止了播放");
    expect(screen.getByRole("button", { name: "成片播放器：播放视频" })).toBeEnabled();
    expect(screen.queryByText("视频暂时无法加载")).not.toBeInTheDocument();
  });

  it("keeps a real decode rejection distinct from browser playback permission", async () => {
    const onError = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("Unsupported", "NotSupportedError"));
    const { container } = render(<VideoPreviewPlayer src="/unsupported.mp4" label="成片播放器"
      ratioClassName="ratio-landscape" onError={onError} />);
    fireEvent.canPlay(container.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("当前视频无法解码");
    expect(screen.getByRole("button", { name: "成片播放器：重新加载视频" })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("ignores a stale playback refusal after a newer request starts playing", async () => {
    let rejectFirst: ((reason: unknown) => void) | undefined;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce();
    const { container } = render(<VideoPreviewPlayer src="/demo.mp4" label="成片播放器"
      ratioClassName="ratio-landscape" />);
    const video = container.querySelector("video")!;
    fireEvent.canPlay(video);

    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    fireEvent.click(screen.getByRole("button", { name: "成片播放器：播放视频" }));
    fireEvent.play(video);
    expect(play).toHaveBeenCalledTimes(2);
    await act(async () => rejectFirst?.(new DOMException("Old request blocked", "NotAllowedError")));

    expect(screen.getByRole("button", { name: "成片播放器：暂停视频" })).toBeInTheDocument();
    expect(screen.queryByText("浏览器阻止了播放", { exact: false })).not.toBeInTheDocument();
  });
});


describe("unknown video geometry", () => {
  it.each([[1280, 720, "ratio-landscape"], [720, 1280, "ratio-portrait"], [720, 720, "ratio-landscape"]])(
    "uses actual %s x %s pixels when no ratio was supplied", (width, height, ratioClass) => {
      const { container } = render(<VideoPreviewPlayer src="/clip.mp4" label="片段" ratioClassName="" />);
      const video = container.querySelector("video")!;
      Object.defineProperties(video, { videoWidth: { value: width }, videoHeight: { value: height }, duration: { value: 5 } });
      fireEvent.loadedMetadata(video);
      expect(screen.getByRole("group", { name: "片段" })).toHaveClass(ratioClass);
      expect(screen.getByRole("button", { name: "片段：播放视频" })).toHaveStyle({ aspectRatio: `${width} / ${height}` });
    });
  it("keeps a supplied ratio and resets unknown geometry on source change", () => {
    const { container, rerender } = render(<VideoPreviewPlayer src="/clip.mp4" label="片段" ratioClassName="" />);
    const video = container.querySelector("video")!;
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, duration: { value: 5 } });
    fireEvent.loadedMetadata(video);
    expect(screen.getByRole("group", { name: "片段" })).toHaveClass("ratio-landscape");
    rerender(<VideoPreviewPlayer src="/portrait.mp4" label="片段" ratioClassName="ratio-portrait" />);
    expect(screen.getByRole("group", { name: "片段" })).toHaveClass("ratio-portrait");
    expect(screen.getByRole("button", { name: "片段：播放视频" }).style.aspectRatio).toBe("");
    rerender(<VideoPreviewPlayer src="/new.mp4" label="片段" ratioClassName="" />);
    expect(screen.getByRole("group", { name: "片段" })).not.toHaveClass("ratio-landscape");
  });
});
