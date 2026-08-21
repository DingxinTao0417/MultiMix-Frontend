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

function project(sourceAssetIds: number[]): ProductArtifact {
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
