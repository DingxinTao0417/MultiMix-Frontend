// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackProductEvent } from "@/lib/product-analytics";
import ConversationStart from "../components/conversation-start";
import ProductWorkspace from "../components/product-workspace";
import RequirementUnderstandingTurn from "../components/requirement-understanding-turn";
import type { ProjectRequirementSnapshot } from "../lib/asset-workspace-types";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";


vi.mock("@/lib/product-analytics", () => ({
  getProductAnalyticsSessionId: () => "test-session",
  trackProductEvent: vi.fn(async () => undefined),
}));


afterEach(() => {
  cleanup();
  vi.mocked(trackProductEvent).mockClear();
});


describe("product analytics event points", () => {
  it("tracks workspace entry and a stable recommendation key without its prompt", async () => {
    const product = displayProducts["case-02-saved-asset-match"];
    render(
      <ConversationStart
        suggestions={[]}
        conversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    await waitFor(() => expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "workspace_opened",
      sessionId: "test-session",
      properties: { entry_surface: "new_conversation" },
    }));
    fireEvent.click(screen.getByRole("button", { name: /讲清楚/ }));

    expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "recommendation_selected",
      properties: { recommendation_key: "goal-explain" },
    });
    expect(JSON.stringify(vi.mocked(trackProductEvent).mock.calls)).not.toContain(
      "把一个概念、过程或结果讲清楚。请先结合我的素材，给出合适的时长、结构和画面方案。",
    );
  });

  it("tracks opening source evidence with only the public asset id", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const product = {
      ...base,
      backendAssetId: 402,
      sourceSummary: {
        headline: "2 项素材依据",
        note: "来源可追溯",
        refs: [{ id: "source-1", title: "门店素材", referenceCount: 1 }],
      },
    };
    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getAllByText("2 项素材依据").at(-1)!);

    expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "source_evidence_opened",
      assetId: 402,
    });
  });

  it("tracks requirement quality events without source text, filenames or choices", async () => {
    const snapshot: ProjectRequirementSnapshot = {
      id: "snapshot-3",
      conversationId: "project-3",
      version: 3,
      parentSnapshotId: null,
      status: "needs_confirmation",
      triggerKind: "source_added",
      conversationText: "我理解的是：private requirement summary。请直接回复你的选择。",
      payload: {
        schemaVersion: "project_requirement_snapshot_v1",
        summary: "private requirement summary",
        goal: "private goal",
        audience: null,
        intent: { operation: "supplement", scope: "project_default", targetItemIds: [], replacementSourceAssetId: null },
        deliverables: [], facts: [],
        requirements: [{
          id: "tone", kind: "style", label: "语气", value: "private style", exactNumeric: false,
          confidence: 0.9, confirmedByUser: false, basis: "explicit",
          evidence: [{ id: "ev-1", sourceAssetId: 31, anchor: "private anchor", quote: "private quote", confidence: 0.9, ocrConfidence: null }],
        }],
        assetUsages: [],
        conflicts: [{
          id: "price", conflictType: "direct_conflict", severity: "blocking", status: "unresolved",
          summary: "private conflict", itemIds: [],
          choices: [{ label: "private choice", evidence_id: "ev-price" }],
          resolution: null, basis: "explicit", evidence: [],
        }],
        sourceAssetIds: [31],
        diff: { addedItemIds: [], removedItemIds: [], changedItemIds: [], newConflictIds: [], resolvedConflictIds: [], usageChangedAssetIds: [] },
      },
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-09-12T08:00:00Z",
      completedAt: "2026-09-12T08:00:01Z",
    };
    render(
      <RequirementUnderstandingTurn
        snapshot={snapshot}
        token="token"
      />,
    );

    await waitFor(() => expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "requirement_summary_viewed",
      conversationId: "project-3",
      properties: { snapshot_version: 3, requirement_status: "needs_confirmation", source_count: 1 },
    }));
    expect(JSON.stringify(vi.mocked(trackProductEvent).mock.calls)).not.toMatch(
      /private requirement|private-file|private quote|private choice/,
    );
  });
});
