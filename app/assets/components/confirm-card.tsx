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
  onConfirm,
  onAdjust,
}: {
  plan: AssetMessagePlan;
  disabled?: boolean;
  optimisticallyConfirmed?: boolean;
  onConfirm?: (plan: AssetMessagePlan, values?: AssetPlanConfirmationValues) => void;
  onAdjust?: (plan: AssetMessagePlan) => void;
}) {
  const ratioOptions = plan.ratioOptions ?? [];
  const [selectedRatio, setSelectedRatio] = useState(
    () => plan.ratioDefault ?? ratioOptions[0]?.value ?? ""
  );
  const [targetSeconds, setTargetSeconds] = useState(
    () => plan.durationSeconds ?? 30
  );
  const isVideoParameterConfirmation = plan.kind === "video_parameter_confirmation";
  const durationMin = plan.durationMin ?? 5;
  const durationMax = plan.durationMax ?? 600;

  if (plan.status === "confirmed" || optimisticallyConfirmed) {
    const summary = plan.summaryFields?.length ? plan.summaryFields : plan.fields;
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
        <PlanFieldRows fields={plan.fields} />
      </div>
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
      {isVideoParameterConfirmation ? (
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
          disabled={disabled || !onConfirm}
          onClick={() => onConfirm?.(
            plan,
            isVideoParameterConfirmation
              ? {
                  ratio: selectedRatio,
                  targetSeconds: Math.max(durationMin, Math.min(durationMax, targetSeconds)),
                }
              : ratioOptions.length
                ? { ratio: selectedRatio }
                : undefined,
          )}
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
    </div>
  );
}
