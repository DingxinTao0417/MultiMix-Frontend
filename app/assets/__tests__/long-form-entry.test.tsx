// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LongFormEntry from "../components/long-form-entry";
import {
  importLongFormSourceUrl,
  uploadLongFormSource,
  waitForLongFormSourceReady,
} from "../lib/long-form-client";

vi.mock("../lib/long-form-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/long-form-client")>();
  return {
    ...original,
    uploadLongFormSource: vi.fn(),
    importLongFormSourceUrl: vi.fn(),
    waitForLongFormSourceReady: vi.fn(),
  };
});

const uploadMock = vi.mocked(uploadLongFormSource);
const importUrlMock = vi.mocked(importLongFormSourceUrl);
const waitReadyMock = vi.mocked(waitForLongFormSourceReady);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("long-form source entry", () => {
  it("shows a dedicated video entry without changing ordinary chat attachments", () => {
    render(<LongFormEntry token="token" onSourceReady={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "上传长视频或粘贴链接" }));

    const input = screen.getByLabelText("选择长视频文件");
    expect(input).toHaveAttribute("accept", ".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska");
    expect(screen.getByPlaceholderText("粘贴 YouTube、Bilibili 或公开 MP4 链接")).toBeInTheDocument();
    expect(screen.getByText(/请确认你拥有素材使用权/)).toBeInTheDocument();
  });

  it("uploads with real progress and immediately starts analysis", async () => {
    const onSourceReady = vi.fn().mockResolvedValue(undefined);
    uploadMock.mockImplementation(async (_token, _file, onProgress) => {
      onProgress(47);
      return { id: 91, title: "访谈第 12 期" };
    });
    render(<LongFormEntry token="token" onSourceReady={onSourceReady} />);
    fireEvent.click(screen.getByRole("button", { name: "上传长视频或粘贴链接" }));

    const file = new File(["video"], "episode.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("选择长视频文件"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith("token", file, expect.any(Function)));
    await waitFor(() => expect(onSourceReady).toHaveBeenCalledWith({ id: 91, title: "访谈第 12 期" }));
  });

  it("imports a supported URL, waits for durable ingest, then starts analysis", async () => {
    const onSourceReady = vi.fn().mockResolvedValue(undefined);
    importUrlMock.mockResolvedValue({
      asset_id: 93,
      job_id: "long-form-ingest-1",
      status: "queued",
      stage: "queued",
      source_kind: "youtube",
    });
    waitReadyMock.mockResolvedValue({
      id: "long-form-ingest-1",
      asset_id: 93,
      status: "completed",
      stage: "source_ready",
      error_message: null,
    });
    render(<LongFormEntry token="token" onSourceReady={onSourceReady} />);
    fireEvent.click(screen.getByRole("button", { name: "上传长视频或粘贴链接" }));
    fireEvent.change(screen.getByPlaceholderText("粘贴 YouTube、Bilibili 或公开 MP4 链接"), {
      target: { value: "https://www.youtube.com/watch?v=abc123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析链接" }));

    await waitFor(() => expect(importUrlMock).toHaveBeenCalledWith(
      "token",
      "https://www.youtube.com/watch?v=abc123",
    ));
    await waitFor(() => expect(waitReadyMock).toHaveBeenCalledWith("token", 93, expect.any(AbortSignal)));
    await waitFor(() => expect(onSourceReady).toHaveBeenCalledWith({ id: 93, title: "网络视频" }));
  });
});
