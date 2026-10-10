// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubtitleReviewPanel from "../components/subtitle-review-panel";
import type { AssetSubtitleControls } from "../lib/asset-workspace-types";

function controls(): Extract<AssetSubtitleControls, { available: true }> {
  return {
    available: true, enabled: true, revision: 3, mode: "source",
    source_language: "zh-CN", target_language: "zh-CN",
    original_audio_ref: "local://presenter-previews/audio.m4a",
    can_enable: true, can_undo: true,
    cues: [
      { cue_id: "cue-a", text: "下令是", source_text: "下令是", start_seconds: 1, end_seconds: 2, user_edited: false },
      { cue_id: "cue-b", text: "另一句。", source_text: "另一句", start_seconds: 4, end_seconds: 5, user_edited: true },
    ],
    revisions: [{ revision: 0, active: false }, { revision: 1, active: true }, { revision: 2, active: false }],
  };
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function open() { fireEvent.click(screen.getByText("核对字幕")); }

describe("user subtitle review panel", () => {
  it("allows initial enable and explains generation stays behind confirmation", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={{ ...controls(), enabled: false,
      revision: 0, can_undo: false, cues: [], revisions: [], enable_requires_generation: true }} onRequest={onRequest} />);
    open();
    expect(screen.getByText("开启后将生成原语言字幕，请在对话中确认。原声和画面保持不变。")).toBeVisible();
    fireEvent.click(screen.getByRole("switch", { name: "添加字幕" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({ assetId: 91, expectedContentHash: "hash",
      expectedSubtitleRevision: 0, action: "set_subtitle_visibility", subtitlesEnabled: true }));
  });

  it("submits only the selected cue, preserving punctuation and newlines", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const value = controls();
    render(<SubtitleReviewPanel assetId={91} contentHash="hash-current" controls={value} onRequest={onRequest} />);
    open();
    fireEvent.click(screen.getAllByRole("button", { name: "修改字幕" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "字幕文字" }), { target: { value: "夏令时，\n开始了。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith({
      assetId: 91, expectedContentHash: "hash-current", expectedSubtitleRevision: 3,
      action: "correct_subtitle", cueId: "cue-a", text: "夏令时，\n开始了。",
    }));
    expect(value.cues[0].text).toBe("下令是");
    expect(screen.getByText("另一句。")).toBeVisible();
    expect(screen.getByText("已人工修改")).toBeVisible();
    expect(screen.getByText("修改请求已发送，请在对话中确认。")).toBeVisible();
  });

  it("submits explicit off and a selected saved version", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} onRequest={onRequest} />);
    open();
    fireEvent.click(screen.getByRole("switch", { name: "添加字幕" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "set_subtitle_visibility", subtitlesEnabled: false })));
    unmount();
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} onRequest={onRequest} />);
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "字幕历史" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "恢复此版" }));
    await waitFor(() => expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({ action: "restore_subtitle_revision", subtitleRevision: 2, expectedSubtitleRevision: 3 })));
  });

  it("routes undo through the same bounded request", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} onRequest={onRequest} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "撤销上次改字" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ action: "undo_subtitle_edit", expectedSubtitleRevision: 3 })));
  });

  it("disables edits while off and allows restoring the saved subtitles", () => {
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={{ ...controls(), enabled: false, can_undo: false }} onRequest={vi.fn()} />);
    open();
    screen.getAllByRole("button", { name: "修改字幕" }).forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole("switch", { name: "添加字幕" })).not.toBeDisabled();
    expect(screen.getByText("关闭仅影响新增字幕，原声和原视频中的文字会保留。")).toBeVisible();
  });

  it("disables writes for a read-only or pending project", () => {
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} disabled onRequest={vi.fn()} />);
    open();
    expect(screen.getByRole("switch", { name: "添加字幕" })).toBeDisabled();
    screen.getAllByRole("button", { name: "修改字幕" }).forEach((button) => expect(button).toBeDisabled());
  });

  it("drops a stale draft when the product version changes", () => {
    const onRequest = vi.fn();
    const { rerender } = render(<SubtitleReviewPanel assetId={91} contentHash="old" controls={controls()} onRequest={onRequest} />);
    open();
    fireEvent.click(screen.getAllByRole("button", { name: "修改字幕" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "字幕文字" }), { target: { value: "old edit" } });
    rerender(<SubtitleReviewPanel assetId={92} contentHash="new" controls={controls()} onRequest={onRequest} />);
    expect(screen.queryByRole("textbox", { name: "字幕文字" })).toBeNull();
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("plays the original cue range and stops at its end and on unmount", async () => {
    const { container, unmount } = render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} onRequest={vi.fn()} />);
    open();
    const audio = container.querySelector("audio")!;
    fireEvent.click(screen.getAllByRole("button", { name: "试听原音" })[0]);
    fireEvent.loadedMetadata(audio);
    await waitFor(() => expect(audio.play).toHaveBeenCalled());
    expect(audio.currentTime).toBe(1);
    audio.currentTime = 2;
    fireEvent.timeUpdate(audio);
    expect(audio.pause).toHaveBeenCalled();
    const calls = vi.mocked(audio.pause).mock.calls.length;
    unmount();
    expect(audio.pause).toHaveBeenCalledTimes(calls + 1);
  });

  it("shows a submission error and permits the same draft to be corrected", async () => {
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} onRequest={vi.fn().mockRejectedValue(new Error("作品已更新"))} />);
    open();
    fireEvent.click(screen.getAllByRole("button", { name: "修改字幕" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "字幕文字" }), { target: { value: "修订。" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存修改" })));
    expect(screen.getByRole("alert")).toHaveTextContent("作品已更新");
    expect(screen.getByRole("textbox", { name: "字幕文字" })).toHaveValue("修订。");
    expect(screen.getByRole("button", { name: "保存修改" })).not.toBeDisabled();
  });

  it("stops audition when review closes and reports original audio errors", async () => {
    const { container } = render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={controls()} onRequest={vi.fn()} />);
    open();
    const audio = container.querySelector("audio")!;
    fireEvent.click(screen.getAllByRole("button", { name: "试听原音" })[0]);
    fireEvent.loadedMetadata(audio);
    await waitFor(() => expect(audio.play).toHaveBeenCalled());
    const panel = screen.getByLabelText("字幕核对") as HTMLDetailsElement;
    panel.open = false;
    fireEvent(panel, new Event("toggle"));
    expect(audio.pause).toHaveBeenCalled();
    panel.open = true;
    fireEvent.error(audio);
    expect(screen.getByRole("alert")).toHaveTextContent("原音暂时无法播放");
  });

  it("shows unavailable versions without inventing controls", () => {
    render(<SubtitleReviewPanel assetId={91} contentHash="hash" controls={{ available: false, reason: "请刷新字幕" }} onRequest={vi.fn()} />);
    open();
    expect(screen.getByText("请刷新字幕")).toBeVisible();
    expect(within(screen.getByLabelText("字幕核对")).queryByRole("switch")).toBeNull();
  });
});
