"use client";

import { Check } from "lucide-react";
import type { AssetMessagePlan, AssetPlanField } from "../lib/asset-workspace-types";

// Two-state confirmation card (spec §5.2 / decision demo final/workspace-copy.html).
// Pending: gradient-bordered card with two-column fields + confirm/adjust buttons.
// Confirmed: compact summary rows + green check badge, no buttons.
// Callers render this only when a message carries a structured plan; otherwise
// the plain message + suggestion chips path is used (spec §12 降级规则).
function PlanFieldRows({ fields, compact }: { fields: AssetPlanField[]; compact?: boolean }) {
  return (
    <>
      {fields.map((field) => (
        <div className={compact ? "shadcn-prototype-confirm-summary-row" : "shadcn-prototype-confirm-row"} key={field.key}>
          <span className="k">{field.label}</span>
          <span className="v">
            {field.value}
            {field.refs?.length ? (
              <span className="shadcn-prototype-confirm-thumbs" aria-hidden={field.refs.every((ref) => !ref.thumbnailUrl) ? true : undefined}>
                {field.refs.map((ref, index) => (
                  <span className="shadcn-prototype-confirm-thumb" key={ref.id ?? `${field.key}-ref-${index}`} title={ref.title}>
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
  onConfirm,
  onAdjust,
}: {
  plan: AssetMessagePlan;
  disabled?: boolean;
  onConfirm?: (plan: AssetMessagePlan) => void;
  onAdjust?: (plan: AssetMessagePlan) => void;
}) {
  if (plan.status === "confirmed") {
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
      {plan.subtitle ? <p className="shadcn-prototype-confirm-sub">{plan.subtitle}</p> : null}
      <div className="shadcn-prototype-confirm-fields">
        <PlanFieldRows fields={plan.fields} />
      </div>
      <div className="shadcn-prototype-confirm-foot">
        <button
          type="button"
          className="shadcn-prototype-confirm-primary"
          disabled={disabled || !onConfirm}
          onClick={() => onConfirm?.(plan)}
        >
          <Check size={14} aria-hidden="true" />
          {plan.confirmLabel ?? "确认，开始生成"}
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
