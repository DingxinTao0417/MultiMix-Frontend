// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmCard from "../components/confirm-card";
import type { AssetMessagePlan } from "../lib/asset-workspace-types";

afterEach(cleanup);

function plan(enabled: boolean): AssetMessagePlan {
  return {
    kind: "video_parameter_confirmation", title: "确认视频参数", status: "pending",
    fields: [{ key: "subtitles", label: "字幕", value: enabled ? "开启" : "关闭" }],
    confirmLabel: "确认参数并生成编导稿", ratioDefault: "16:9", durationSeconds: 30,
    pendingIntentId: "subtitle-parameters", pendingIntentVersion: 1,
    subtitlesEnabledDefault: enabled,
  };
}

describe("subtitle selection in video parameter confirmation", () => {
  it("keeps an unsubmitted project choice on refresh but resets it for a new director snapshot", () => {
    const project: AssetMessagePlan = { ...plan(true), kind: "video_project_confirmation",
      directorAssetId: 42, directorContentHash: "draft-a" };
    const { rerender } = render(<ConfirmCard plan={project} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "不添加字幕" }));
    rerender(<ConfirmCard plan={{ ...project }} onConfirm={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "不添加字幕" })).toHaveAttribute("aria-checked", "true");
    rerender(<ConfirmCard plan={{ ...project, directorContentHash: "draft-b" }} onConfirm={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "添加字幕" })).toHaveAttribute("aria-checked", "true");
  });
  it.each([true, false])("project confirmation submits subtitle choice %s without requiring BGM or ratio options", (enabled) => {
    const onConfirm = vi.fn();
    const project: AssetMessagePlan = { ...plan(!enabled), kind: "video_project_confirmation",
      subtitleDefault: "source", subtitleOptions: [{ value: "source", label: "原文字幕" }] };
    render(<ConfirmCard plan={project} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("radio", { name: enabled ? "添加字幕" : "不添加字幕" }));
    expect(Boolean(screen.queryByRole("radiogroup", { name: "字幕语言" }))).toBe(enabled);
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));
    expect(onConfirm.mock.calls[0]?.[1]).toMatchObject({ subtitlesEnabled: enabled });
    if (!enabled) expect(onConfirm.mock.calls[0]?.[1]).not.toHaveProperty("sourceSubtitleMode");
  });
  it.each([true, false])("Presenter confirmation submits visibility %s and hides language when off", (enabled) => {
    const onConfirm = vi.fn();
    const presenter: AssetMessagePlan = { ...plan(!enabled), kind: "presenter_project_confirmation",
      directionDefault: "direction-a", ratioOptions: [{ value: "16:9", label: "横屏" }],
      subtitleDefault: "source", subtitleOptions: [{ value: "source", label: "原文字幕" }] };
    render(<ConfirmCard plan={presenter} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("radio", { name: enabled ? "添加字幕" : "不添加字幕" }));
    expect(Boolean(screen.queryByRole("radiogroup", { name: "字幕语言" }))).toBe(enabled);
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));
    expect(onConfirm.mock.calls[0]?.[1]).toMatchObject({ subtitlesEnabled: enabled, directorCandidateId: "direction-a" });
    if (!enabled) expect(onConfirm.mock.calls[0]?.[1]).not.toHaveProperty("sourceSubtitleMode");
  });
  it.each([true, false])("submits an explicit choice from default %s", (enabled) => {
    const onConfirm = vi.fn();
    render(<ConfirmCard plan={plan(enabled)} onConfirm={onConfirm} />);
    const choices = screen.getByRole("radiogroup", { name: "添加字幕" });
    expect(within(choices).getByRole("radio", { name: enabled ? "添加字幕" : "不添加字幕" }))
      .toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(choices).getByRole("radio", { name: enabled ? "不添加字幕" : "添加字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subtitlesEnabled: !enabled,
    }));
    expect(screen.getByText("仅控制新增的语音字幕，原视频中的已有文字会保留。")).toBeVisible();
  });

  it("keeps a saved disabled default when confirmed without changing it", () => {
    const onConfirm = vi.fn();
    render(<ConfirmCard plan={plan(false)} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ subtitlesEnabled: false }));
  });

  it("keeps a pending local choice on refresh, then adopts a new server revision", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<ConfirmCard plan={plan(true)} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("radio", { name: "不添加字幕" }));
    rerender(<ConfirmCard plan={{ ...plan(true) }} onConfirm={onConfirm} />);
    expect(screen.getByRole("radio", { name: "不添加字幕" })).toHaveAttribute("aria-checked", "true");
    rerender(<ConfirmCard plan={{ ...plan(true), pendingIntentVersion: 2 }} onConfirm={onConfirm} />);
    expect(screen.getByRole("radio", { name: "添加字幕" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "不添加字幕" }));
    rerender(<ConfirmCard plan={{ ...plan(true), pendingIntentId: "different-video" }} onConfirm={onConfirm} />);
    expect(screen.getByRole("radio", { name: "添加字幕" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the submitted choice in the optimistic confirmation summary", () => {
    const { rerender } = render(<ConfirmCard plan={plan(true)} onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "不添加字幕" }));
    rerender(<ConfirmCard plan={plan(true)} optimisticallyConfirmed onConfirm={vi.fn()} />);
    expect(screen.getByText("关闭")).toBeVisible();
    expect(screen.queryByText("开启")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "添加字幕" })).toBeNull();
  });

  it("disables subtitle changes while a confirmation is being sent", () => {
    render(<ConfirmCard plan={plan(true)} disabled onConfirm={vi.fn()} />);
    const choices = screen.getByRole("radiogroup", { name: "添加字幕" });
    within(choices).getAllByRole("radio").forEach((option) => expect(option).toBeDisabled());
  });

  it("does not invent a subtitle default for a historical parameter card", () => {
    const onConfirm = vi.fn();
    const historical = { ...plan(true), subtitlesEnabledDefault: undefined };
    render(<ConfirmCard plan={historical} onConfirm={onConfirm} />);
    expect(screen.queryByRole("radiogroup", { name: "添加字幕" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));
    expect(onConfirm.mock.calls[0]?.[1]).not.toHaveProperty("subtitlesEnabled");
  });
});
