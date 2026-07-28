"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  VoiceoverApiError,
  applyProjectVoice,
  applySegmentVoice,
  pollVideoJob,
  restoreVoiceVersion,
  submitVoicePreview,
  voicePreviewUrl,
  type ProjectVoiceRequestArgs,
  type VideoJob,
  type VoiceRequestArgs,
  type VoiceoverDraft,
} from "./voiceover-api";

export type VoiceoverApi = {
  submitVoicePreview: (args: VoiceRequestArgs) => Promise<VideoJob>;
  applySegmentVoice: (args: VoiceRequestArgs) => Promise<VideoJob>;
  applyProjectVoice: (args: ProjectVoiceRequestArgs) => Promise<VideoJob>;
  pollVideoJob: (jobId: string, token: string) => Promise<VideoJob>;
  restoreVoiceVersion: (args: {
    assetId: string;
    versionId: number;
    token: string;
  }) => Promise<void>;
  voicePreviewUrl: (audioRef: string) => string;
};

const defaultApi: VoiceoverApi = {
  submitVoicePreview,
  applySegmentVoice,
  applyProjectVoice,
  pollVideoJob,
  restoreVoiceVersion,
  voicePreviewUrl,
};

const VOICES = [
  ["female_warm", "女声 · 温暖"],
  ["female_bright", "女声 · 明亮"],
  ["male_steady", "男声 · 沉稳"],
  ["male_energetic", "男声 · 有活力"],
] as const;

const ENERGIES = [
  ["calm_confident", "平静自信"],
  ["warm_clear", "温暖清晰"],
  ["bright_energetic", "明亮有活力"],
  ["steady_authoritative", "沉稳有力量"],
] as const;

const SPEEDS = [0.9, 1, 1.1, 1.2] as const;

type BusyAction = "preview" | "segment" | "project" | "restore" | null;

export default function VoiceoverEditor({
  assetId,
  segmentId,
  token,
  narration,
  currentVoiceName = "female_warm",
  disabled = false,
  api = defaultApi,
  initiallyExpanded = false,
  onBusyChange,
  onCancel,
  onJobStarted,
  onProjectUpdated,
}: {
  assetId: string;
  segmentId: string;
  token: string;
  narration: string;
  currentVoiceName?: string;
  disabled?: boolean;
  api?: VoiceoverApi;
  initiallyExpanded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCancel?: () => void;
  onJobStarted?: (jobId: string) => void;
  onProjectUpdated?: () => void;
}) {
  const initialDraft = useMemo<VoiceoverDraft>(
    () => ({
      narration,
      voiceName: currentVoiceName,
      voiceSpeed: 1,
      energy: "warm_clear",
      pronunciations: [],
    }),
    [currentVoiceName, narration],
  );
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [draft, setDraft] = useState<VoiceoverDraft>(initialDraft);
  const [previewJob, setPreviewJob] = useState<VideoJob | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [undoVersionId, setUndoVersionId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setPreviewJob(null);
    setError("");
  }, [initialDraft, segmentId]);

  useEffect(() => {
    const stored = sessionStorage.getItem(`multimix:voice-undo:${assetId}`);
    const parsed = stored ? Number(stored) : Number.NaN;
    setUndoVersionId(Number.isInteger(parsed) && parsed > 0 ? parsed : null);
  }, [assetId]);

  useEffect(() => {
    onBusyChange?.(busy !== null);
  }, [busy, onBusyChange]);

  const finishJob = async (job: VideoJob): Promise<VideoJob> => {
    onJobStarted?.(job.id);
    const finished =
      job.status === "completed" || job.status === "failed"
        ? job
        : await api.pollVideoJob(job.id, token);
    if (finished.status === "failed") {
      const failedSegment = finished.result.narration_failure?.segment_id;
      throw new Error(
        failedSegment
          ? `第 ${failedSegment} 段配音失败，旧视频没有被修改。`
          : finished.error_message || "配音失败，旧视频没有被修改。",
      );
    }
    return finished;
  };

  const requestArgs = (confirmOverwrite = false): VoiceRequestArgs => ({
    assetId,
    segmentId,
    token,
    draft,
    previewJobId: previewJob?.id,
    confirmOverwrite,
  });

  const handlePreview = async () => {
    setBusy("preview");
    setError("");
    try {
      const finished = await finishJob(
        await api.submitVoicePreview(requestArgs()),
      );
      if (!finished.result.voice_preview) {
        throw new Error("试听音频没有生成，请重试。");
      }
      setPreviewJob(finished);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const apply = async (
    scope: "segment" | "project",
    confirmOverwrite = false,
  ) => {
    setBusy(scope);
    setError("");
    try {
      const args = requestArgs(confirmOverwrite);
      const queued =
        scope === "segment"
          ? await api.applySegmentVoice(args)
          : await api.applyProjectVoice(args);
      const finished = await finishJob(queued);
      const versionId = finished.result.undo_version_id;
      if (typeof versionId === "number") {
        sessionStorage.setItem(
          `multimix:voice-undo:${assetId}`,
          String(versionId),
        );
        setUndoVersionId(versionId);
      }
      onProjectUpdated?.();
    } catch (cause) {
      if (
        cause instanceof VoiceoverApiError
        && cause.code === "timeline_dirty"
        && window.confirm(cause.message)
      ) {
        setBusy(null);
        await apply(scope, true);
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async () => {
    if (!undoVersionId) return;
    setBusy("restore");
    setError("");
    try {
      await api.restoreVoiceVersion({ assetId, versionId: undoVersionId, token });
      sessionStorage.removeItem(`multimix:voice-undo:${assetId}`);
      setUndoVersionId(null);
      onProjectUpdated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const updateDraft = (next: VoiceoverDraft) => {
    setDraft(next);
    setPreviewJob(null);
    setError("");
  };
  const preview = previewJob?.result.voice_preview;
  const currentVoiceLabel =
    VOICES.find(([name]) => name === currentVoiceName)?.[1] ?? "当前声音";
  const actionDisabled = disabled || busy !== null;

  const applyProject = () => {
    if (!window.confirm("这会把当前声音设置应用到全部分镜，确定继续吗？")) return;
    void apply("project");
  };

  if (!expanded) {
    return (
      <div
        className="shadcn-prototype-voiceover-summary"
        data-testid="voiceover-editor"
      >
        <span className="shadcn-prototype-voiceover-copy" title={narration}>
          {narration}
        </span>
        <span className="shadcn-prototype-voiceover-current">
          {currentVoiceLabel}
        </span>
        <button
          type="button"
          className="shadcn-prototype-voiceover-secondary"
          disabled={disabled}
          onClick={() => setExpanded(true)}
        >
          修改配音
        </button>
        {undoVersionId ? (
          <button
            type="button"
            className="shadcn-prototype-voiceover-secondary"
            disabled={actionDisabled}
            onClick={() => void handleRestore()}
          >
            撤销本次配音
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className="shadcn-prototype-voiceover-editor"
      data-testid="voiceover-editor"
      aria-label="配音修改"
    >
      <label className="shadcn-prototype-voiceover-field">
        <span>配音文本</span>
        <textarea
          aria-label="配音文本"
          maxLength={2000}
          rows={3}
          value={draft.narration}
          onChange={(event) =>
            updateDraft({ ...draft, narration: event.target.value })
          }
        />
      </label>

      <fieldset className="shadcn-prototype-voiceover-options">
        <legend>声音</legend>
        <div>
          {VOICES.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name={`voice-${segmentId}`}
                value={value}
                checked={draft.voiceName === value}
                onChange={() => updateDraft({ ...draft, voiceName: value })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="shadcn-prototype-voiceover-options">
        <legend>语速</legend>
        <div>
          {SPEEDS.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`speed-${segmentId}`}
                value={value}
                checked={draft.voiceSpeed === value}
                onChange={() => updateDraft({ ...draft, voiceSpeed: value })}
              />
              <span>{value.toFixed(1)}×</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="shadcn-prototype-voiceover-field compact">
        <span>表达感觉</span>
        <select
          aria-label="表达感觉"
          value={draft.energy}
          onChange={(event) =>
            updateDraft({
              ...draft,
              energy: event.target.value as VoiceoverDraft["energy"],
            })
          }
        >
          {ENERGIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="shadcn-prototype-voiceover-pronunciations">
        <div className="shadcn-prototype-voiceover-section-heading">
          <span>发音提示（可选）</span>
          <button
            type="button"
            className="shadcn-prototype-voiceover-secondary"
            disabled={draft.pronunciations.length >= 20}
            onClick={() =>
              updateDraft({
                ...draft,
                pronunciations: [
                  ...draft.pronunciations,
                  { text: "", spokenAs: "" },
                ],
              })
            }
          >
            添加词语
          </button>
        </div>
        {draft.pronunciations.map((item, index) => (
          <div
            className="shadcn-prototype-voiceover-pronunciation-row"
            key={`${index}-${item.text}`}
          >
            <input
              aria-label={`词语 ${index + 1}`}
              placeholder="词语"
              value={item.text}
              onChange={(event) => {
                const pronunciations = [...draft.pronunciations];
                pronunciations[index] = {
                  ...item,
                  text: event.target.value,
                };
                updateDraft({ ...draft, pronunciations });
              }}
            />
            <span>读作</span>
            <input
              aria-label={`读作 ${index + 1}`}
              placeholder="希望的读法"
              value={item.spokenAs}
              onChange={(event) => {
                const pronunciations = [...draft.pronunciations];
                pronunciations[index] = {
                  ...item,
                  spokenAs: event.target.value,
                };
                updateDraft({ ...draft, pronunciations });
              }}
            />
            <button
              type="button"
              aria-label={`删除发音提示 ${index + 1}`}
              onClick={() =>
                updateDraft({
                  ...draft,
                  pronunciations: draft.pronunciations.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {error ? (
        <p className="shadcn-prototype-voiceover-error" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div className="shadcn-prototype-voiceover-preview">
          <audio
            ref={audioRef}
            preload="metadata"
            src={api.voicePreviewUrl(preview.audio_ref)}
          />
          <button
            type="button"
            className="shadcn-prototype-voiceover-secondary"
            onClick={() => void audioRef.current?.play()}
          >
            播放试听
          </button>
          <span>{preview.duration_seconds.toFixed(1)} 秒</span>
        </div>
      ) : null}

      <div className="shadcn-prototype-voiceover-actions">
        <button
          type="button"
          className="shadcn-prototype-voiceover-primary"
          disabled={actionDisabled || !draft.narration.trim()}
          onClick={() => void handlePreview()}
        >
          {busy === "preview" ? "正在生成试听…" : "生成试听"}
        </button>
        <button
          type="button"
          className="shadcn-prototype-voiceover-primary"
          disabled={actionDisabled || !preview}
          onClick={() => void apply("segment")}
        >
          {busy === "segment" ? "正在应用…" : "应用到当前分镜"}
        </button>
        <button
          type="button"
          className="shadcn-prototype-voiceover-secondary"
          disabled={actionDisabled || !preview}
          onClick={applyProject}
        >
          {busy === "project" ? "正在应用到全片…" : "应用到全部分镜"}
        </button>
        <button
          type="button"
          className="shadcn-prototype-voiceover-secondary"
          disabled={actionDisabled}
          onClick={() => {
            setDraft(initialDraft);
            setPreviewJob(null);
            setError("");
            if (onCancel) {
              onCancel();
            } else {
              setExpanded(false);
            }
          }}
        >
          取消
        </button>
      </div>
      <p className="shadcn-prototype-voiceover-help">
        先试听再应用。应用失败时，当前视频和试听都不会丢失。
      </p>
    </section>
  );
}
