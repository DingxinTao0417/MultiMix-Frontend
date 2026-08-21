// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProductWorkspace, { findLongFormCandidateProduct } from "../components/product-workspace";
import type { ProductArtifact } from "../lib/asset-workspace-shared";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

function candidate(id: string, sourceAssetId: number): ProductArtifact {
  return {
    id,
    backendAssetId: Number(id.replace(/\D/g, "")) || 1,
    contentType: "long_form_candidate_set",
    mode: "copy",
    title: "拆条候选",
    status: "完成",
    productStatus: "completed",
    summary: "从长视频提取的候选片段。",
    ratio: "9:16",
    duration: "",
    phase: "拆条候选",
    sections: [],
    timeline: [],
    actions: [],
    metadata: { source_asset_id: sourceAssetId },
  };
}

function project(
  sourceAssetIds: number[],
  projectSegmentSourceAssetIds: number[] = [],
  projectSegmentExcerptAssetIds: number[] = [],
  compatibleSegmentSourceAssetIds: number[] = [],
  analysisAssetId?: number,
): ProductArtifact {
  return {
    ...displayProducts["case-07-project-ready-mp4"],
    id: "source-project",
    contentType: "video_project",
    metadata: {
      ...displayProducts["case-07-project-ready-mp4"].metadata,
      video_plan: {
        scenes: sourceAssetIds.map((source_asset_id) => ({
          audio_intent: { mode: "source_clip", source_asset_id },
        })),
      },
      video_project: {
        segments: [
          ...projectSegmentSourceAssetIds.map((source_asset_id) => ({
            audio_intent: { mode: "source_clip", source_asset_id },
          })),
          ...projectSegmentExcerptAssetIds.map((chosen_asset_id) => ({
            asset_reference: {
              chosen_asset_id,
              source_range: { mode: "continuous_excerpt" },
            },
          })),
        ],
      },
      video_segments: compatibleSegmentSourceAssetIds.map((source_asset_id) => ({
        audio_intent: { mode: "source_clip", source_asset_id },
      })),
      ...(analysisAssetId ? { long_form_selection: { analysis_asset_id: analysisAssetId } } : {}),
    },
  };
}

describe("long-form candidate re-entry", () => {
  it("returns the latest candidate from the same uploaded source only", () => {
    const first = candidate("candidate-11", 88);
    const latest = candidate("candidate-12", 88);

    expect(findLongFormCandidateProduct(project([88]), [first, candidate("candidate-13", 89), latest])).toBe(latest);
  });

  it("does not guess a candidate when the project mixes source videos", () => {
    expect(findLongFormCandidateProduct(project([88, 89]), [candidate("candidate-11", 88)])).toBeNull();
  });

  it("uses the project's exact public analysis link before source compatibility fields", () => {
    const exactCandidate = candidate("candidate-101", 89);
    const sourceCompatibleCandidate = candidate("candidate-102", 88);

    expect(findLongFormCandidateProduct(project([88], [], [], [], 101), [sourceCompatibleCandidate, exactCandidate]))
      .toBe(exactCandidate);
  });

  it("does not guess from a source when an exact analysis link has no visible candidate", () => {
    expect(findLongFormCandidateProduct(project([88], [], [], [], 101), [candidate("candidate-102", 88)]))
      .toBeNull();
  });

  it("recovers the only candidate in a historical conversation when the project has no public linkage", () => {
    const onlyCandidate = candidate("candidate-11", 88);

    expect(findLongFormCandidateProduct(project([]), [onlyCandidate])).toBe(onlyCandidate);
  });

  it("does not recover a candidate by order when a historical conversation has more than one", () => {
    expect(findLongFormCandidateProduct(project([]), [candidate("candidate-11", 88), candidate("candidate-12", 89)]))
      .toBeNull();
  });

  it("recovers one candidate explicitly referenced by the same conversation when project sources are mixed", () => {
    const referencedCandidate = candidate("candidate-11", 88);

    expect(findLongFormCandidateProduct(
      project([88, 89]),
      [referencedCandidate],
      [{ role: "assistant", text: "已完成拆条", assetId: referencedCandidate.backendAssetId }],
    )).toBe(referencedCandidate);
  });

  it("does not recover an unreferenced candidate from a mixed-source project", () => {
    const candidateSet = candidate("candidate-11", 88);

    expect(findLongFormCandidateProduct(
      project([88, 89]),
      [candidateSet],
      [{ role: "assistant", text: "其他产物", assetId: 999 }],
    )).toBeNull();
  });

  it("uses the completed project's public segment source when the draft scenes are absent", () => {
    const relatedCandidate = candidate("candidate-11", 88);

    expect(findLongFormCandidateProduct(project([], [88]), [relatedCandidate])).toBe(relatedCandidate);
  });

  it("prioritizes the completed project's source over a stale draft projection", () => {
    const finishedProjectCandidate = candidate("candidate-11", 88);
    const staleDraftCandidate = candidate("candidate-12", 89);

    expect(findLongFormCandidateProduct(project([89], [88]), [staleDraftCandidate, finishedProjectCandidate]))
      .toBe(finishedProjectCandidate);
  });

  it("uses a source-ranged asset reference when the completed project has no audio-intent projection", () => {
    const relatedCandidate = candidate("candidate-11", 88);

    expect(findLongFormCandidateProduct(project([], [], [88]), [relatedCandidate])).toBe(relatedCandidate);
  });

  it("uses a compatible video-segments source when the project has no source clip", () => {
    const relatedCandidate = candidate("candidate-11", 88);

    expect(findLongFormCandidateProduct(project([], [], [], [88]), [relatedCandidate])).toBe(relatedCandidate);
  });

  it("opens the associated candidates without starting a new generation", () => {
    const relatedCandidate = candidate("candidate-11", 88);
    const videoProject = project([88]);
    const conversation = {
      ...conversationForDisplayProduct(videoProject),
      products: [relatedCandidate, videoProject],
    };
    const openCandidates = vi.fn();

    render(createElement(ProductWorkspace, {
      copied: false,
      onCopyProduct: vi.fn(async () => undefined),
      onSaveProduct: vi.fn(async () => undefined),
      onOpenLongFormCandidates: openCandidates,
      product: videoProject,
      selectedConversation: conversation,
    }));

    fireEvent.click(screen.getByRole("button", { name: "尝试其他拆条方式" }));
    expect(openCandidates).toHaveBeenCalledOnce();
    expect(openCandidates).toHaveBeenCalledWith(relatedCandidate);
  });
});
