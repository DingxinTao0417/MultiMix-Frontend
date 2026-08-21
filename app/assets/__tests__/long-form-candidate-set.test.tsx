// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LongFormCandidateSet from "../components/long-form-candidate-set";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const analysis = {
  schema_version: "long_form_candidate_set:v1" as const,
  source_asset_id: 91,
  chapters: [
    { id: "chapter_01", start_seconds: 0, end_seconds: 120, title: "增长质量", summary: "收入与现金流。" },
    { id: "chapter_02", start_seconds: 120, end_seconds: 240, title: "利润回款", summary: "利润与回款速度。" },
  ],
  top_candidate_ids: ["cand_01", "cand_02"],
  candidates: [
    {
      id: "cand_01",
      title: "别只看收入",
      why_publish: "观点完整，适合作为独立判断。",
      source_start_seconds: 12,
      source_end_seconds: 57,
      target_seconds: 45,
      core_quote: "增长不能只看收入",
      recommended_ratio: "9:16" as const,
      visual_completeness: "complete" as const,
      grounded: true,
    },
    {
      id: "cand_02",
      title: "利润要和回款一起看",
      why_publish: "反常识且有明确原话。",
      source_start_seconds: 135,
      source_end_seconds: 195,
      target_seconds: 60,
      core_quote: "利润和回款速度必须一起判断",
      recommended_ratio: "source" as const,
      visual_completeness: "incomplete" as const,
      grounded: true,
    },
  ],
};

describe("long-form candidate set", () => {
  it("shows the real chapter and Top count without padding", () => {
    render(
      <LongFormCandidateSet
        analysisAssetId={92}
        analysis={analysis}
      />,
    );

    expect(screen.getByText("2 个章节")).toBeInTheDocument();
    expect(screen.getByText("2 条优先候选")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "别只看收入" })).toBeInTheDocument();
    expect(screen.getByText("画面信息不完整")).toBeInTheDocument();
    expect(screen.queryByText("候选 3")).not.toBeInTheDocument();
  });

  it("dispatches an exact structured selection", () => {
    const handler = vi.fn();
    window.addEventListener("multimix:long-form-action", handler);
    render(
      <LongFormCandidateSet
        analysisAssetId={92}
        analysis={analysis}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "把“别只看收入”提炼成短片" }));

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      kind: "select",
      analysisAssetId: 92,
      candidateId: "cand_01",
    });
    window.removeEventListener("multimix:long-form-action", handler);
  });

  it("defaults to preserving the source's complete meaning", () => {
    const handler = vi.fn();
    window.addEventListener("multimix:long-form-action", handler);
    render(
      <LongFormCandidateSet
        analysisAssetId={92}
        analysis={analysis}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "完整保留原意" }));

    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      kind: "preserve",
      analysisAssetId: 92,
    });
    window.removeEventListener("multimix:long-form-action", handler);
  });
});
