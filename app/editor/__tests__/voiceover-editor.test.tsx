// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VoiceoverEditor, { type VoiceoverApi } from "../VoiceoverEditor";
import type { VideoJob } from "../voiceover-api";

const previewJob: VideoJob = {
  id: "voice-preview-1",
  asset_id: 7,
  status: "completed",
  workflow_stage: "video_project_ready",
  error_message: null,
  result: {
    voice_preview: {
      segment_id: "scene-1",
      audio_ref: "local://preview/scene-1.mp3",
      duration_seconds: 2.4,
    },
  },
};

function apiFixture(): VoiceoverApi {
  return {
    submitVoicePreview: vi.fn().mockResolvedValue(previewJob),
    applySegmentVoice: vi.fn().mockResolvedValue({
      ...previewJob,
      id: "apply-segment-1",
      result: { undo_version: 3, undo_version_id: 103 },
    }),
    applyProjectVoice: vi.fn().mockResolvedValue({
      ...previewJob,
      id: "apply-project-1",
      result: { undo_version: 4, undo_version_id: 104 },
    }),
    pollVideoJob: vi.fn().mockResolvedValue(previewJob),
    restoreVoiceVersion: vi.fn().mockResolvedValue(undefined),
    voicePreviewUrl: vi.fn().mockReturnValue("/v1/video/media?ref=preview"),
  };
}

const baseProps = {
  assetId: "7",
  segmentId: "scene-1",
  token: "secret-token",
  narration: "原来的口播",
  currentVoiceName: "female_warm",
  disabled: false,
  onJobStarted: vi.fn(),
  onProjectUpdated: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("VoiceoverEditor", () => {
  it("previews before enabling apply", async () => {
    const api = apiFixture();
    render(<VoiceoverEditor {...baseProps} api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "修改配音" }));
    fireEvent.change(screen.getByLabelText("配音文本"), {
      target: { value: "修改后的口播" },
    });
    expect(
      screen.getByRole("button", { name: "应用到当前分镜" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "生成试听" }));

    expect(
      await screen.findByRole("button", { name: "播放试听" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "应用到当前分镜" }),
    ).toBeEnabled();
  });

  it("can apply the preview to every scene", async () => {
    const api = apiFixture();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<VoiceoverEditor {...baseProps} api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "修改配音" }));
    fireEvent.click(screen.getByRole("button", { name: "生成试听" }));
    await screen.findByRole("button", { name: "播放试听" });

    fireEvent.click(screen.getByRole("button", { name: "应用到全部分镜" }));

    await waitFor(() =>
      expect(api.applyProjectVoice).toHaveBeenCalledWith(
        expect.objectContaining({ previewJobId: "voice-preview-1" }),
      ),
    );
    expect(sessionStorage.getItem("multimix:voice-undo:7")).toBe("104");
  });

  it("does not apply the preview to every scene when confirmation is cancelled", async () => {
    const api = apiFixture();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<VoiceoverEditor {...baseProps} api={api} initiallyExpanded />);
    fireEvent.click(screen.getByRole("button", { name: "生成试听" }));
    await screen.findByRole("button", { name: "播放试听" });

    fireEvent.click(screen.getByRole("button", { name: "应用到全部分镜" }));

    expect(window.confirm).toHaveBeenCalledWith("这会把当前声音设置应用到全部分镜，确定继续吗？");
    expect(api.applyProjectVoice).not.toHaveBeenCalled();
  });

  it("reports busy state and uses the external cancel handler in dialog mode", async () => {
    let finishPreview!: (job: VideoJob) => void;
    const api = apiFixture();
    api.submitVoicePreview = vi.fn().mockReturnValue(
      new Promise<VideoJob>((resolve) => {
        finishPreview = resolve;
      }),
    );
    const onBusyChange = vi.fn();
    const onCancel = vi.fn();
    render(
      <VoiceoverEditor
        {...baseProps}
        api={api}
        initiallyExpanded
        onBusyChange={onBusyChange}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成试听" }));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    finishPreview(previewJob);
    await screen.findByRole("button", { name: "播放试听" });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("restores with the database version id returned by the job", async () => {
    const api = apiFixture();
    sessionStorage.setItem("multimix:voice-undo:7", "104");
    render(<VoiceoverEditor {...baseProps} api={api} />);

    fireEvent.click(await screen.findByRole("button", { name: "撤销本次配音" }));

    await waitFor(() =>
      expect(api.restoreVoiceVersion).toHaveBeenCalledWith({
        assetId: "7",
        versionId: 104,
        token: "secret-token",
      }),
    );
  });
});
