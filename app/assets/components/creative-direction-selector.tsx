"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { AssetCreativeDirectionSelection } from "../lib/asset-workspace-types";

type CreativeDirectionCandidate = {
  id: string;
  angle: string;
  hook: string;
  narrativeStructure: string[];
  visualLanguage: string;
  assetStrategy: string;
  audioDirection: string;
  evidenceStrategy: string;
  differenceAxes: string[];
};

type CreativeDirectionView = {
  fingerprint: string;
  candidateCountReason: string;
  candidates: CreativeDirectionCandidate[];
  recommendedId: string;
  selectedId: string;
  selectionReason: string;
  selectionSource: "model_recommended" | "user";
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => textValue(item)).filter(Boolean)
    : [];
}

export function creativeDirectionView(value: unknown): CreativeDirectionView | null {
  const raw = recordValue(value);
  if (!raw || raw.schema_version !== "creative_direction:v1") return null;
  const fingerprint = textValue(raw.fingerprint);
  const recommendedId = textValue(raw.recommended_id);
  const selectedId = textValue(raw.selected_id) || recommendedId;
  const selectionSource = raw.selection_source === "user" ? "user" : "model_recommended";
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) return null;
  if (!Array.isArray(raw.candidates) || raw.candidates.length < 1 || raw.candidates.length > 5) return null;

  const candidates = raw.candidates.flatMap((item): CreativeDirectionCandidate[] => {
    const candidate = recordValue(item);
    const id = textValue(candidate?.id);
    const angle = textValue(candidate?.angle);
    const hook = textValue(candidate?.hook);
    if (!candidate || !id || !angle || !hook) return [];
    return [{
      id,
      angle,
      hook,
      narrativeStructure: textList(candidate.narrative_structure),
      visualLanguage: textValue(candidate.visual_language),
      assetStrategy: textValue(candidate.asset_strategy),
      audioDirection: textValue(candidate.audio_direction),
      evidenceStrategy: textValue(candidate.evidence_strategy),
      differenceAxes: textList(candidate.difference_axes),
    }];
  });
  if (
    candidates.length !== raw.candidates.length
    || !candidates.some((candidate) => candidate.id === recommendedId)
    || !candidates.some((candidate) => candidate.id === selectedId)
  ) return null;

  return {
    fingerprint,
    candidateCountReason: textValue(raw.candidate_count_reason),
    candidates,
    recommendedId,
    selectedId,
    selectionReason: textValue(raw.selection_reason),
    selectionSource,
  };
}

export default function CreativeDirectionSelector({
  direction,
  disabled = false,
  onApply,
}: {
  direction: unknown;
  disabled?: boolean;
  onApply?: (selection: AssetCreativeDirectionSelection) => Promise<void>;
}) {
  const parsed = useMemo(() => creativeDirectionView(direction), [direction]);
  const [expanded, setExpanded] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setExpanded(false);
    setApplyingId("");
    setSubmittedId("");
    setError("");
  }, [parsed?.fingerprint, parsed?.selectedId]);

  if (!parsed) return null;
  const selected = parsed.candidates.find((candidate) => candidate.id === parsed.selectedId)!;
  const visibleCandidates = expanded ? parsed.candidates : [selected];
  const canBrowseMore = parsed.candidates.length > 1;

  const applyCandidate = async (candidate: CreativeDirectionCandidate) => {
    if (!onApply || disabled || applyingId || submittedId || candidate.id === parsed.selectedId) return;
    setApplyingId(candidate.id);
    setError("");
    try {
      await onApply({
        candidateId: candidate.id,
        creativeDirectionFingerprint: parsed.fingerprint,
      });
      setSubmittedId(candidate.id);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "方向应用失败，请重试。");
    } finally {
      setApplyingId("");
    }
  };

  return (
    <section
      className="mx-5 mb-4 rounded-2xl border border-[#e5e0d8] bg-[#faf8f4] p-4 text-[#2f2b27]"
      aria-label="创意方向"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">创意方向</h4>
          <p className="mt-1 text-xs leading-5 text-[#736e67]">
            {parsed.selectionSource === "user"
              ? "当前已应用你选择的方向；查看其他方向不会修改编导稿。"
              : "当前已自动采用推荐方向；查看其他方向不会修改编导稿。"}
          </p>
        </div>
        {canBrowseMore ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[#5f5a54] hover:bg-white"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "收起其他方向" : "查看其他方向"}
            {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3">
        {visibleCandidates.map((candidate) => {
          const isSelected = candidate.id === parsed.selectedId;
          const isApplying = candidate.id === applyingId;
          return (
            <article
              key={candidate.id}
              className={`rounded-xl border p-3 ${isSelected ? "border-[#bcb2a4] bg-white" : "border-[#e5e0d8] bg-[#fffdfa]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{candidate.angle}</strong>
                    {isSelected ? (
                      <span className="rounded-full bg-[#ece8df] px-2 py-0.5 text-[11px] text-[#5f5a54]">
                        {parsed.selectionSource === "user" ? "已应用" : "当前采用"}
                      </span>
                    ) : candidate.id === parsed.recommendedId ? (
                      <span className="rounded-full bg-[#ece8df] px-2 py-0.5 text-[11px] text-[#5f5a54]">推荐</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[#4d4944]">Hook：{candidate.hook}</p>
                </div>
                {!isSelected ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-[#2f2b27] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={isApplying ? `正在应用“${candidate.angle}”方向` : `应用“${candidate.angle}”方向`}
                    disabled={!onApply || disabled || Boolean(applyingId) || Boolean(submittedId)}
                    onClick={() => void applyCandidate(candidate)}
                  >
                    {isApplying ? "正在应用…" : "应用此方向"}
                  </button>
                ) : null}
              </div>
              {candidate.narrativeStructure.length ? (
                <p className="mt-2 text-xs leading-5 text-[#736e67]">
                  结构：{candidate.narrativeStructure.join(" → ")}
                </p>
              ) : null}
              {candidate.visualLanguage ? (
                <p className="text-xs leading-5 text-[#736e67]">画面：{candidate.visualLanguage}</p>
              ) : null}
              {expanded && candidate.assetStrategy ? (
                <p className="text-xs leading-5 text-[#736e67]">素材：{candidate.assetStrategy}</p>
              ) : null}
              {expanded && candidate.audioDirection ? (
                <p className="text-xs leading-5 text-[#736e67]">声音：{candidate.audioDirection}</p>
              ) : null}
              {expanded && candidate.evidenceStrategy ? (
                <p className="text-xs leading-5 text-[#736e67]">证据：{candidate.evidenceStrategy}</p>
              ) : null}
              {expanded && candidate.differenceAxes.length ? (
                <p className="mt-1 text-[11px] leading-5 text-[#8a837b]">差异维度：{candidate.differenceAxes.join("、")}</p>
              ) : null}
            </article>
          );
        })}
      </div>

      {parsed.selectionReason ? (
        <p className="mt-3 text-xs leading-5 text-[#736e67]">
          {parsed.selectionSource === "user" ? "原推荐理由" : "推荐理由"}：{parsed.selectionReason}
        </p>
      ) : null}
      {expanded && parsed.candidateCountReason ? (
        <p className="mt-3 text-xs leading-5 text-[#8a837b]">候选数量：{parsed.candidateCountReason}</p>
      ) : null}
      {submittedId ? <p className="mt-3 text-xs text-[#4f6f52]" role="status">已提交，正在重排编导稿。</p> : null}
      {error ? <p className="mt-3 text-xs text-[#a43b32]" role="alert">{error}</p> : null}
    </section>
  );
}
