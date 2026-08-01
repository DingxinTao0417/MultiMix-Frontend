// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VideoProjectPreview, { type VideoProjectPreviewHandle } from "../components/video-project-preview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function publishPreviewState(iframe: HTMLIFrameElement, overrides: Record<string, unknown> = {}) {
  const event = new MessageEvent("message", {
    origin: window.location.origin,
    data: {
      source: "multimix-editor",
      assetId: 9100,
      previewChannel: "preview-test",
      type: "multimix-editor-preview-state",
      time: 1.5,
      duration: 3,
      playing: false,
      ...overrides,
    },
  });
  Object.defineProperty(event, "source", { value: iframe.contentWindow });
  fireEvent(window, event);
}

describe("video project preview", () => {
  it("uses a short user-facing loading message inside the player", () => {
    render(
      <VideoProjectPreview
        assetId={9100}
        ratioClassName="ratio-landscape"
        durationSeconds={3}
        channelId="preview-test"
      />,
    );

    expect(screen.getByText("正在准备预览")).toBeInTheDocument();
    expect(screen.queryByText("正在准备工程预览…")).not.toBeInTheDocument();
  });

  it("renders the preview editor and mirrors its playback state", () => {
    render(
      <VideoProjectPreview
        assetId={9100}
        ratioClassName="ratio-landscape"
        durationSeconds={3}
        channelId="preview-test"
      />,
    );

    const iframe = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    expect(iframe).toHaveAttribute(
      "src",
      "/editor?asset=9100&embed=1&mode=preview&previewChannel=preview-test",
    );

    publishPreviewState(iframe);

    expect(screen.getByText("00:01")).toBeInTheDocument();
    expect(screen.getByText("00:03")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toHaveValue("1.5");
  });

  it("sends toggle, seek, and segment jump commands only to its own iframe", () => {
    const ref = createRef<VideoProjectPreviewHandle>();
    render(
      <VideoProjectPreview
        ref={ref}
        assetId={9100}
        ratioClassName="ratio-portrait"
        durationSeconds={3}
        channelId="preview-test"
      />,
    );

    const iframe = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
    publishPreviewState(iframe);

    fireEvent.click(screen.getByRole("button", { name: "点击画面播放视频" }));
    expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-preview-toggle" },
      window.location.origin,
    );

    fireEvent.change(screen.getByRole("slider", { name: "播放进度" }), { target: { value: "2" } });
    expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-preview-seek", time: 2 },
      window.location.origin,
    );

    act(() => ref.current?.seekAndPlay(1));
    expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-preview-seek", time: 1 },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { source: "multimix-workspace", type: "multimix-editor-preview-play" },
      window.location.origin,
    );
  });

  it("ignores preview state messages from another window", () => {
    render(
      <VideoProjectPreview
        assetId={9100}
        ratioClassName="ratio-landscape"
        durationSeconds={3}
        channelId="preview-test"
      />,
    );

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: window,
      data: {
        source: "multimix-editor",
        assetId: 9100,
        previewChannel: "preview-test",
        type: "multimix-editor-preview-state",
        time: 2,
        duration: 3,
        playing: true,
      },
    }));

    expect(screen.getByRole("slider", { name: "播放进度" })).toHaveValue("0");
    expect(screen.getByRole("button", { name: "点击画面播放视频" })).toBeInTheDocument();
  });

  it("ignores messages with a different preview channel", () => {
    render(
      <VideoProjectPreview
        assetId={9100}
        ratioClassName="ratio-landscape"
        durationSeconds={3}
        channelId="preview-test"
      />,
    );

    const iframe = screen.getByTitle("视频工程预播") as HTMLIFrameElement;
    publishPreviewState(iframe, { previewChannel: "another-preview", time: 2 });

    expect(screen.getByRole("slider", { name: "播放进度" })).toHaveValue("0");
  });
});
