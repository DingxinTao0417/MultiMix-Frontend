// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConfirmCard from "../components/confirm-card";

describe("ConfirmCard pending state", () => {
  it("does not show the video-project generation explanation", () => {
    render(
      <ConfirmCard
        plan={{
          title: "视频方案",
          status: "pending",
          subtitle: "确认这版方案后生成可编辑视频工程。",
          fields: [{ key: "duration", label: "时长", value: "约 30 秒" }],
        }}
        onConfirm={() => undefined}
        onAdjust={() => undefined}
      />,
    );

    expect(screen.queryByText("确认这版方案后生成可编辑视频工程。")).toBeNull();
  });

  it("hides legacy CTA fields from persisted plans", () => {
    render(
      <ConfirmCard
        plan={{
          title: "视频方案",
          status: "pending",
          fields: [
            { key: "duration", label: "时长", value: "约 30 秒" },
            { key: "cta", label: "结尾引导", value: "预约咨询" },
          ],
        }}
      />,
    );

    expect(screen.getByText("约 30 秒")).toBeTruthy();
    expect(screen.queryByText("结尾引导")).toBeNull();
    expect(screen.queryByText("预约咨询")).toBeNull();
  });

  it("submits the selected ratio and duration for video parameter confirmation", () => {
    const onConfirm = vi.fn();
    const plan = {
      kind: "video_parameter_confirmation" as const,
      title: "确认视频参数",
      status: "pending" as const,
      fields: [
        { key: "ratio", label: "视频比例", value: "横屏 16:9（默认）" },
        { key: "duration", label: "目标时长", value: "30 秒（默认）" },
      ],
      confirmLabel: "确认参数并生成编导稿",
      ratioOptions: [
        { value: "16:9", label: "横屏 16:9" },
        { value: "9:16", label: "竖屏 9:16" },
      ],
      ratioDefault: "16:9",
      voiceOptions: [
        { value: true, label: "生成 AI 配音" },
        { value: false, label: "不生成 AI 配音" },
      ],
      voiceDefault: true,
      ttsAvailable: true,
      durationSeconds: 30,
      durationMin: 5,
      durationMax: 120,
      pendingIntentId: "pending-1",
      pendingIntentVersion: 1,
    };

    render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);

    expect(screen.getByText("横屏 16:9（默认）")).toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "竖屏 9:16" }));
    fireEvent.click(screen.getByRole("radio", { name: "不生成 AI 配音" }));
    fireEvent.change(screen.getByLabelText("目标时长（秒）"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, {
      ratio: "9:16",
      targetSeconds: 45,
      aiVoiceEnabled: false,
    });
  });

  it("shows only the published presenter recommendation and submits it", () => {
    const onConfirm = vi.fn();
    const plan = {
      kind: "presenter_project_confirmation" as const,
      title: "口播型方案",
      status: "pending" as const,
      fields: [
        { key: "source_edit", label: "原话与删剪", value: "保留 42 秒 · 删除 1 段" },
      ],
      confirmLabel: "确认推荐方案并生成视频",
      adjustLabel: "换个方向",
      recommendationMode: "single_winner" as const,
      ratioOptions: [
        { value: "9:16", label: "竖屏 9:16" },
        { value: "16:9", label: "横屏 16:9" },
      ],
      ratioDefault: "9:16",
      durationSeconds: 42,
      durationMin: 5,
      durationMax: 120,
      subtitleOptions: [
        { value: "translated_zh" as const, label: "中文字幕" },
        { value: "source" as const, label: "原文字幕" },
        { value: "bilingual" as const, label: "中英双语" },
      ],
      subtitleDefault: "translated_zh" as const,
      directionDefault: "direction-a",
      directionOptions: [
        {
          id: "direction-a",
          label: "观点与证据交替",
          concept: "人物建立信任，证据短时接管",
          reason: "原片观点清楚，少量证据足够",
          recommended: true,
          sampleUrl: "/samples/a.mp4",
          durationSeconds: 8,
        },
      ],
    };

    render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);

    expect(screen.getByText("推荐")).toBeTruthy();
    expect(screen.getByText("人物建立信任，证据短时接管")).toBeTruthy();
    expect(screen.getAllByLabelText("方向动态样片")).toHaveLength(1);
    expect(screen.queryByRole("radiogroup", { name: "口播导演方向" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "横屏 16:9" }));
    fireEvent.click(screen.getByRole("radio", { name: "中英双语" }));
    fireEvent.change(screen.getByLabelText("目标时长（秒）"), { target: { value: "43" } });
    fireEvent.click(screen.getByRole("button", { name: "确认推荐方案并生成视频" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, {
      ratio: "16:9",
      targetSeconds: 43,
      directorCandidateId: "direction-a",
      sourceSubtitleMode: "bilingual",
    });
  });

  it("requires a ratio choice and blocks unavailable default AI voice", () => {
    const onConfirm = vi.fn();
    const plan = {
      kind: "video_parameter_confirmation" as const,
      title: "确认视频参数",
      status: "pending" as const,
      fields: [
        { key: "ratio", label: "视频比例", value: "需要你选择" },
        { key: "ai_voice", label: "AI 配音", value: "开启（默认）" },
      ],
      confirmLabel: "确认参数并生成编导稿",
      ratioOptions: [
        { value: "16:9", label: "横屏 16:9" },
        { value: "9:16", label: "竖屏 9:16" },
      ],
      ratioConfirmationRequired: true,
      voiceOptions: [
        { value: true, label: "生成 AI 配音" },
        { value: false, label: "不生成 AI 配音" },
      ],
      voiceDefault: true,
      ttsAvailable: false,
      voiceBlockedUntilDisabled: true,
      durationSeconds: 30,
      pendingIntentId: "pending-conflict",
      pendingIntentVersion: 1,
    };

    render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);

    expect(screen.getByRole("alert").textContent).toContain("AI 配音当前不可用");
    expect(
      screen.getByRole("button", { name: "确认参数并生成编导稿" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "竖屏 9:16" }));
    fireEvent.click(screen.getByRole("radio", { name: "不生成 AI 配音" }));
    fireEvent.click(screen.getByRole("button", { name: "确认参数并生成编导稿" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, {
      ratio: "9:16",
      targetSeconds: 30,
      aiVoiceEnabled: false,
    });
  });

  it("reviews cleanup items and freezes an explicit audio track before directing", () => {
    const onConfirm = vi.fn();
    const plan = {
      kind: "presenter_cleanup_confirmation" as const,
      title: "口播清理",
      status: "pending" as const,
      fields: [{ key: "cleanup", label: "自然精简", value: "自动 1 项 · 建议 1 项" }],
      confirmLabel: "确认清理并进入导演方案",
      cleanupPlanId: "cleanup-1",
      cleanupPlanHash: "a".repeat(64),
      cleanupItems: [
        {
          id: "auto-1",
          state: "auto" as const,
          category: "non_lexical_filler",
          spokenText: "嗯",
          action: "delete",
          reason: "孤立口癖",
          estimatedSavingSeconds: 0.4,
          risk: "low",
          audioRisk: "low",
          visualJumpRisk: "medium",
          protectionReasons: [],
          decisionLabel: "自动通过",
          decisionReason: "删除不改变原意、语气或逻辑关系",
          semanticReview: {
            verdict: "approve" as const,
            reason: "删除不改变原意、语气或逻辑关系",
          },
          secondaryRecognition: {
            status: "confirmed" as const,
            label: "第二次识别一致，已恢复自动处理",
            model: "paraformer-v2",
          },
          selected: true,
          locked: false,
        },
        {
          id: "suggested-1",
          state: "suggested" as const,
          category: "phrase_repetition",
          spokenText: "再说一次",
          action: "delete",
          reason: "较长重说",
          estimatedSavingSeconds: 1.2,
          risk: "medium",
          audioRisk: "low",
          visualJumpRisk: "high",
          protectionReasons: [],
          decisionLabel: "降为建议",
          decisionReason: "可能承担承接上句的表达作用",
          semanticReview: {
            verdict: "downgrade" as const,
            reason: "可能承担承接上句的表达作用",
          },
          secondaryRecognition: {
            status: "disagreed" as const,
            label: "两次识别不一致，保持建议",
          },
          selected: false,
          locked: false,
        },
      ],
      audioTrackDefault: 1,
      audioTrackOptions: [
        { streamIndex: 1, label: "人声轨 1", previewUrl: "", qualityScore: 0.9, recommended: true, channels: 1, codec: "aac" },
        { streamIndex: 2, label: "人声轨 2", previewUrl: "", qualityScore: 0.8, recommended: false, channels: 2, codec: "aac" },
      ],
    };

    render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);

    expect(screen.getByText("自动通过")).toBeTruthy();
    expect(screen.getByText("删除不改变原意、语气或逻辑关系")).toBeTruthy();
    expect(screen.getByText("第二次识别一致，已恢复自动处理")).toBeTruthy();
    expect(screen.getByText("降为建议")).toBeTruthy();
    expect(screen.getByText("可能承担承接上句的表达作用")).toBeTruthy();
    expect(screen.getByText("两次识别不一致，保持建议")).toBeTruthy();
    fireEvent.click(screen.getByText("再说一次"));
    fireEvent.click(screen.getByRole("radio", { name: "人声轨 2" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理并进入导演方案" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, {
      cleanupCandidateIds: ["auto-1", "suggested-1"],
      protectedOverrideCandidateIds: [],
      confirmProtectedOverride: false,
      audioStreamIndex: 2,
    });
  });

  it("confirms an exact audio track before generating cleanup", () => {
    const onConfirm = vi.fn();
    const plan = {
      kind: "presenter_audio_selection_confirmation" as const,
      title: "选择口播原声",
      status: "pending" as const,
      confirmationId: "presenter-audio-selection-current",
      fields: [{ key: "audio", label: "有效人声音轨", value: "检测到 2 条" }],
      confirmLabel: "确认原声并生成清理方案",
      audioTrackDefault: 1,
      audioTrackOptions: [
        {
          streamIndex: 1,
          label: "人声轨 1",
          previewUrl: "",
          qualityScore: 0.9,
          recommended: true,
          channels: 1,
          codec: "aac",
          audioFingerprint: "sha256:audio-1",
          transcriptHash: "sha256:transcript-1",
        },
        {
          streamIndex: 2,
          label: "人声轨 2",
          previewUrl: "",
          qualityScore: 0.8,
          recommended: false,
          channels: 2,
          codec: "aac",
          audioFingerprint: "sha256:audio-2",
          transcriptHash: "sha256:transcript-2",
        },
      ],
    };

    render(<ConfirmCard plan={plan} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("radio", { name: "人声轨 2" }));
    fireEvent.click(screen.getByRole("button", { name: "确认原声并生成清理方案" }));

    expect(onConfirm).toHaveBeenCalledWith(plan, {
      audioStreamIndex: 2,
      audioFingerprint: "sha256:audio-2",
      transcriptHash: "sha256:transcript-2",
    });
  });
});
