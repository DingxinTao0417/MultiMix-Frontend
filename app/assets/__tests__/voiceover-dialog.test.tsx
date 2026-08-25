// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoJob } from "../../editor/voiceover-api";
import type { VoiceoverApi } from "../../editor/VoiceoverEditor";
import VoiceoverDialog from "../components/voiceover-dialog";

const segment = {
  id: "segment-1",
  index: 1,
  line: "欢迎来到我们的门店",
  voiceName: "male_steady",
  isFallback: false,
};

const previewJob: VideoJob = {
  id: "preview-1",
  asset_id: 9100,
  status: "completed",
  workflow_stage: "video_project_ready",
  error_message: null,
  result: {
    voice_preview: {
      segment_id: "segment-1",
      audio_ref: "local://preview/segment-1.mp3",
      duration_seconds: 2.1,
    },
  },
};

function apiFixture(): VoiceoverApi {
  return {
    submitVoicePreview: vi.fn().mockResolvedValue(previewJob),
    applySegmentVoice: vi.fn().mockResolvedValue({
      ...previewJob,
      id: "apply-1",
      result: { undo_version: 2, undo_version_id: 102 },
    }),
    applyProjectVoice: vi.fn().mockResolvedValue(previewJob),
    pollVideoJob: vi.fn().mockResolvedValue(previewJob),
    restoreVoiceVersion: vi.fn().mockResolvedValue(undefined),
    voicePreviewUrl: vi.fn().mockReturnValue("/v1/video/media?ref=preview"),
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("VoiceoverDialog", () => {
  it("uses the shared focus lifecycle and restores its trigger", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>打开配音修改</button>
          <VoiceoverDialog
            open={open}
            assetId="9100"
            segment={segment}
            token="token"
            api={apiFixture()}
            onClose={() => setOpen(false)}
            onProjectUpdated={vi.fn()}
          />
        </>
      );
    }

    render(<StrictMode><Harness /></StrictMode>);
    const trigger = screen.getByRole("button", { name: "打开配音修改" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "修改分镜 #1 配音" });
    const close = within(dialog).getByRole("button", { name: "关闭" });
    await waitFor(() => expect(close).toHaveFocus());
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled])")];
    const last = focusable.at(-1)!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("blocks every close path while a voice task is running", async () => {
    let finishPreview!: (job: VideoJob) => void;
    const api = apiFixture();
    api.submitVoicePreview = vi.fn().mockReturnValue(
      new Promise<VideoJob>((resolve) => {
        finishPreview = resolve;
      }),
    );
    const onClose = vi.fn();

    render(
      <VoiceoverDialog
        open
        assetId="9100"
        segment={segment}
        token="token"
        api={api}
        onClose={onClose}
        onProjectUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成试听" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("voiceover-dialog-mask"));
    expect(onClose).not.toHaveBeenCalled();

    finishPreview(previewJob);
    await screen.findByRole("button", { name: "播放试听" });
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("notifies the workspace after applying the selected segment", async () => {
    const api = apiFixture();
    const onProjectUpdated = vi.fn();
    render(
      <VoiceoverDialog
        open
        assetId="9100"
        segment={segment}
        token="token"
        api={api}
        onClose={vi.fn()}
        onProjectUpdated={onProjectUpdated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成试听" }));
    await screen.findByRole("button", { name: "播放试听" });
    fireEvent.click(screen.getByRole("button", { name: "应用到当前分镜" }));

    await waitFor(() => expect(onProjectUpdated).toHaveBeenCalledTimes(1));
  });
});
