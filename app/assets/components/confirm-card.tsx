"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { AssetMessagePlan, AssetPlanConfirmationValues, AssetPlanField } from "../lib/asset-workspace-types";

// Two-state confirmation card (spec §5.2 / decision demo final/workspace-copy.html).
// Pending: gradient-bordered card with two-column fields + confirm/adjust buttons.
// Confirmed: compact summary rows + green check badge, no buttons.
// Callers render this only when a message carries a structured plan; otherwise
// the plain message + suggestion chips path is used (spec §12 降级规则).
function PlanFieldRows({ fields, compact }: { fields: AssetPlanField[]; compact?: boolean }) {
  const visibleFields = fields.filter((field) => field.key !== "cta");
  return (
    <>
      {visibleFields.map((field) => (
        <div className={compact ? "shadcn-prototype-confirm-summary-row" : "shadcn-prototype-confirm-row"} key={field.key}>
          <span className="k">{field.label}</span>
          <span className="v">
            {field.value}
            {field.refs?.length ? (
              <span className="shadcn-prototype-confirm-thumbs" aria-hidden={field.refs.every((ref) => !ref.thumbnailUrl) ? true : undefined}>
                {field.refs.map((ref, index) => (
                  <span className="shadcn-prototype-confirm-thumb" key={ref.id ?? `${field.key}-ref-${index}`} title={ref.title}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- dynamic blob:/remote thumbnail URLs are unsupported by next/image */}
                    {ref.thumbnailUrl ? <img src={ref.thumbnailUrl} alt="" loading="lazy" /> : null}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </>
  );
}

export default function ConfirmCard({
  plan,
  disabled = false,
  optimisticallyConfirmed = false,
  maintenanceMessage,
  onConfirm,
  onAdjust,
}: {
  plan: AssetMessagePlan;
  disabled?: boolean;
  optimisticallyConfirmed?: boolean;
  maintenanceMessage?: string;
  onConfirm?: (plan: AssetMessagePlan, values?: AssetPlanConfirmationValues) => void;
  onAdjust?: (plan: AssetMessagePlan) => void;
}) {
  const ratioOptions = plan.ratioOptions ?? [];
  const [selectedRatio, setSelectedRatio] = useState(
    () => plan.ratioDefault ?? (plan.ratioConfirmationRequired ? "" : ratioOptions[0]?.value ?? "")
  );
  const voiceOptions = plan.voiceOptions ?? [];
  const [selectedAiVoice, setSelectedAiVoice] = useState<boolean | undefined>(
    () => plan.voiceDefault,
  );
  const [targetSeconds, setTargetSeconds] = useState(
    () => plan.durationSeconds ?? 30
  );
  const directionOptions = plan.directionOptions ?? [];
  const [selectedDirection, setSelectedDirection] = useState(
    () => plan.directionDefault ?? directionOptions[0]?.id ?? ""
  );
  const cleanupItems = plan.cleanupItems ?? [];
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<Set<string>>(
    () => new Set(cleanupItems.filter((item) => item.selected).map((item) => item.id))
  );
  const audioTrackOptions = plan.audioTrackOptions ?? [];
  const subtitleOptions = plan.subtitleOptions ?? [];
  const [selectedSubtitleMode, setSelectedSubtitleMode] = useState(
    () => plan.subtitleDefault ?? subtitleOptions[0]?.value,
  );
  const [selectedAudioStream, setSelectedAudioStream] = useState<number | undefined>(
    () => plan.audioTrackDefault ?? audioTrackOptions[0]?.streamIndex
  );
  const isVideoParameterConfirmation = plan.kind === "video_parameter_confirmation";
  const isPresenterProjectConfirmation = plan.kind === "presenter_project_confirmation";
  const isPresenterAudioSelectionConfirmation = plan.kind === "presenter_audio_selection_confirmation";
  const isPresenterCleanupConfirmation = plan.kind === "presenter_cleanup_confirmation";
  const isSingleWinnerRecommendation = plan.recommendationMode === "single_winner";
  const voiceBlocked = isVideoParameterConfirmation
    && selectedAiVoice === true
    && plan.ttsAvailable === false;
  const durationMin = plan.durationMin ?? 5;
  const durationMax = plan.durationMax ?? 600;
  const currentFields = isVideoParameterConfirmation
    ? plan.fields.map((field) => {
        if (field.key === "ratio" && selectedRatio && selectedRatio !== plan.ratioDefault) {
          return {
            ...field,
            value: ratioOptions.find((option) => option.value === selectedRatio)?.label ?? selectedRatio,
          };
        }
        if (
          field.key === "duration"
          && targetSeconds !== (plan.durationSeconds ?? 30)
        ) {
          return { ...field, value: `${targetSeconds} 秒` };
        }
        if (
          field.key === "ai_voice"
          && selectedAiVoice !== undefined
          && selectedAiVoice !== plan.voiceDefault
        ) {
          return { ...field, value: selectedAiVoice ? "开启" : "关闭" };
        }
        return field;
      })
    : plan.fields;

  if (plan.status === "confirmed" || optimisticallyConfirmed) {
    const summary = plan.status === "confirmed" && plan.summaryFields?.length
      ? plan.summaryFields
      : currentFields;
    return (
      <div className="shadcn-prototype-confirm-card confirmed" aria-label={`${plan.title} · 已确认`}>
        <div className="shadcn-prototype-confirm-done-head">
          <strong>{plan.title}</strong>
          <span className="shadcn-prototype-confirm-ok">
            <Check size={11} aria-hidden="true" />
            已确认
          </span>
        </div>
        <div className="shadcn-prototype-confirm-summary">
          <PlanFieldRows fields={summary} compact />
        </div>
      </div>
    );
  }

  return (
    <div className="shadcn-prototype-confirm-card pending" aria-label={`${plan.title} · 待确认`}>
      <div className="shadcn-prototype-confirm-head">
        <span className="shadcn-prototype-confirm-title">{plan.title}</span>
        <span className="shadcn-prototype-confirm-badge">
          <span className="shadcn-prototype-confirm-dot" aria-hidden="true" />
          待确认
        </span>
      </div>
      <div className="shadcn-prototype-confirm-fields">
        <PlanFieldRows fields={currentFields} />
      </div>
      {cleanupItems.length ? (
        <div className="shadcn-prototype-confirm-cleanup" aria-label="口播清理项目">
          {cleanupItems.map((item) => {
            const checked = selectedCleanupIds.has(item.id);
            const decisionLabel = item.decisionLabel ?? {
              auto: "自动处理",
              suggested: "建议确认",
              protected: "已保护",
            }[item.state];
            const decisionReason = item.decisionReason || item.reason;
            return (
              <label key={item.id} data-state={item.state}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || plan.requiresClarification}
                  onChange={() => setSelectedCleanupIds((current) => {
                    const next = new Set(current);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })}
                />
                <span>
                  <strong>{item.spokenText || item.category}</strong>
                  <em>{decisionLabel}</em>
                  <small>{decisionReason}</small>
                  {item.reason && item.reason !== decisionReason ? <small>候选判断：{item.reason}</small> : null}
                  {item.secondaryRecognition ? (
                    <>
                      <small>{item.secondaryRecognition.label}</small>
                      {item.secondaryRecognition.model ? (
                        <small>交叉识别模型：{item.secondaryRecognition.model}</small>
                      ) : null}
                    </>
                  ) : null}
                  <small>预计缩短 {item.estimatedSavingSeconds.toFixed(1)} 秒</small>
                  <small>音频风险 {item.audioRisk} · 跳切风险 {item.visualJumpRisk}</small>
                  {item.protectionReasons.length ? <em>保护：{item.protectionReasons.join("、")}</em> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
      {audioTrackOptions.length ? (
        <div className="shadcn-prototype-confirm-audio-tracks" role="radiogroup" aria-label="原声音轨">
          <span className="shadcn-prototype-confirm-ratio-label">原声音轨</span>
          {audioTrackOptions.map((option) => (
            <label key={option.streamIndex}>
              <input
                type="radio"
                name="presenter-audio-track"
                checked={selectedAudioStream === option.streamIndex}
                disabled={disabled}
                onChange={() => setSelectedAudioStream(option.streamIndex)}
              />
              <span>{option.label}{option.recommended ? "（推荐）" : ""}</span>
              {option.previewUrl ? <audio controls preload="metadata" src={option.previewUrl} /> : null}
            </label>
          ))}
        </div>
      ) : null}
      {directionOptions.length ? (
        <div
          className="shadcn-prototype-confirm-directions"
          {...(!isSingleWinnerRecommendation ? { role: "radiogroup", "aria-label": "口播导演方向" } : {})}
        >
          <span className="shadcn-prototype-confirm-ratio-label">导演方向与动态样片</span>
          <div className="shadcn-prototype-confirm-direction-options">
            {(isSingleWinnerRecommendation ? directionOptions.slice(0, 1) : directionOptions).map((option) => {
              const content = (
                <>
                <video
                  aria-label="方向动态样片"
                  src={option.sampleUrl}
                  controls
                  preload="metadata"
                  playsInline
                />
                <span className="shadcn-prototype-confirm-direction-copy">
                  <strong>{option.label}</strong>
                  {option.recommended ? <span>推荐</span> : null}
                  <span>{option.concept}</span>
                  <small>{option.reason}</small>
                </span>
                </>
              );
              return isSingleWinnerRecommendation ? (
                <article key={option.id} className="active" aria-label={`${option.label}（推荐方案）`}>
                  {content}
                </article>
              ) : (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={option.id === selectedDirection}
                  aria-label={`${option.label}${option.recommended ? "（推荐）" : ""}`}
                  className={option.id === selectedDirection ? "active" : undefined}
                  disabled={disabled}
                  onClick={() => setSelectedDirection(option.id)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {ratioOptions.length ? (
        <div className="shadcn-prototype-confirm-ratio" role="radiogroup" aria-label="视频尺寸">
          <span className="shadcn-prototype-confirm-ratio-label">视频尺寸</span>
          <div className="shadcn-prototype-confirm-ratio-options">
            {ratioOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === selectedRatio}
                className={option.value === selectedRatio ? "active" : undefined}
                disabled={disabled}
                onClick={() => setSelectedRatio(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {voiceOptions.length ? (
        <div className="shadcn-prototype-confirm-ratio" role="radiogroup" aria-label="AI 配音">
          <span className="shadcn-prototype-confirm-ratio-label">AI 配音</span>
          <div className="shadcn-prototype-confirm-ratio-options">
            {voiceOptions.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={option.value === selectedAiVoice}
                className={option.value === selectedAiVoice ? "active" : undefined}
                disabled={disabled}
                onClick={() => setSelectedAiVoice(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {voiceBlocked ? (
        <p role="alert" className="shadcn-prototype-confirm-warning">
          AI 配音当前不可用。你可以关闭配音继续，系统不会生成半成品。
        </p>
      ) : null}
      {subtitleOptions.length ? (
        <div className="shadcn-prototype-confirm-ratio" role="radiogroup" aria-label="字幕语言">
          <span className="shadcn-prototype-confirm-ratio-label">字幕语言</span>
          <div className="shadcn-prototype-confirm-ratio-options">
            {subtitleOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === selectedSubtitleMode}
                className={option.value === selectedSubtitleMode ? "active" : undefined}
                disabled={disabled}
                onClick={() => setSelectedSubtitleMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {isVideoParameterConfirmation || isPresenterProjectConfirmation ? (
        <label className="shadcn-prototype-confirm-duration">
          <span className="shadcn-prototype-confirm-ratio-label">目标时长（秒）</span>
          <input
            type="number"
            aria-label="目标时长（秒）"
            min={durationMin}
            max={durationMax}
            value={targetSeconds}
            disabled={disabled}
            onChange={(event) => setTargetSeconds(Number(event.currentTarget.value))}
          />
        </label>
      ) : null}
      <div className="shadcn-prototype-confirm-foot">
        <button
          type="button"
          className="shadcn-prototype-confirm-primary"
          disabled={
            disabled
            || !onConfirm
            || Boolean(plan.requiresClarification)
            || (isVideoParameterConfirmation && plan.ratioConfirmationRequired === true && !selectedRatio)
            || (isVideoParameterConfirmation && voiceOptions.length > 0 && selectedAiVoice === undefined)
            || voiceBlocked
          }
          onClick={() => {
            if (isPresenterAudioSelectionConfirmation) {
              const selectedTrack = audioTrackOptions.find(
                (option) => option.streamIndex === selectedAudioStream,
              );
              if (
                selectedTrack
                && selectedTrack.audioFingerprint
                && selectedTrack.transcriptHash
              ) {
                onConfirm?.(plan, {
                  audioStreamIndex: selectedTrack.streamIndex,
                  audioFingerprint: selectedTrack.audioFingerprint,
                  transcriptHash: selectedTrack.transcriptHash,
                });
              }
              return;
            }
            if (isPresenterCleanupConfirmation) {
              const protectedIds = cleanupItems
                .filter((item) => item.locked && selectedCleanupIds.has(item.id))
                .map((item) => item.id);
              const confirmed = protectedIds.length === 0
                || globalThis.confirm("所选内容包含数字、否定、条件或其他保护信息。确认仍要删除吗？");
              if (!confirmed) return;
              onConfirm?.(plan, {
                cleanupCandidateIds: [...selectedCleanupIds],
                protectedOverrideCandidateIds: protectedIds,
                confirmProtectedOverride: protectedIds.length > 0,
                audioStreamIndex: selectedAudioStream,
              });
              return;
            }
            onConfirm?.(
              plan,
              isVideoParameterConfirmation
              ? {
                  ratio: selectedRatio,
                  targetSeconds: Math.max(durationMin, Math.min(durationMax, targetSeconds)),
                  aiVoiceEnabled: selectedAiVoice,
                }
              : ratioOptions.length
                ? {
                    ratio: selectedRatio,
                    ...(isPresenterProjectConfirmation ? {
                      targetSeconds: Math.max(durationMin, Math.min(durationMax, targetSeconds)),
                    } : {}),
                    ...(selectedDirection ? { directorCandidateId: selectedDirection } : {}),
                    ...(selectedSubtitleMode ? { sourceSubtitleMode: selectedSubtitleMode } : {}),
                  }
                : selectedDirection
                  ? { directorCandidateId: selectedDirection }
                  : selectedSubtitleMode
                    ? { sourceSubtitleMode: selectedSubtitleMode }
                    : undefined,
            );
          }}
        >
          <Check size={14} aria-hidden="true" />
          {plan.confirmLabel ?? "确认"}
        </button>
        <button
          type="button"
          className="shadcn-prototype-confirm-ghost"
          disabled={disabled || !onAdjust}
          onClick={() => onAdjust?.(plan)}
        >
          {plan.adjustLabel ?? "调整方向"}
        </button>
      </div>
      {maintenanceMessage ? <p role="status">{maintenanceMessage}</p> : null}
    </div>
  );
}
