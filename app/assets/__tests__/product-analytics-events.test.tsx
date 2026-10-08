// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadVideoFeedback, submitVideoFeedback, trackProductEvent } from "@/lib/product-analytics";
import ConversationStart from "../components/conversation-start";
import ProductWorkspace from "../components/product-workspace";
import RequirementUnderstandingTurn from "../components/requirement-understanding-turn";
import type { ProjectRequirementSnapshot } from "../lib/asset-workspace-types";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";


vi.mock("@/lib/product-analytics", () => ({
  getProductAnalyticsSessionId: () => "test-session",
  trackProductEvent: vi.fn(async () => undefined),
  loadVideoFeedback: vi.fn(async () => ({ decision: null, published: false, versionId: 7 })),
  submitVideoFeedback: vi.fn(async (_token, _assetId, versionId, decision) => ({
    decision: decision === "published" ? "accepted" : decision,
    published: decision === "published",
    versionId,
  })),
}));


afterEach(() => {
  cleanup();
  vi.mocked(trackProductEvent).mockClear();
  vi.mocked(submitVideoFeedback).mockClear();
  vi.mocked(loadVideoFeedback).mockClear();
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
    fireEvent.click(within(screen.getByRole("region", { name: "你想怎么开始？" })).getByRole("button", { name: /从想法开始/ }));

    expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "recommendation_selected",
      properties: { recommendation_key: "start-idea" },
    });
    expect(JSON.stringify(vi.mocked(trackProductEvent).mock.calls)).not.toContain(
      "我想做一条新视频，先从想法开始。请先帮我明确目标，再和我讨论内容、画面，以及需要哪些素材。",
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

  it("records explicit video acceptance and publication only after the user clicks", async () => {
    const base = displayProducts["case-07-project-ready-mp4"];
    const product = { ...base, backendAssetId: 402,
      versions: [{ id: "7", label: "v1", savedAt: "现在", status: "初始版本" }] };
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);

    expect(submitVideoFeedback).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "这版可以发布" }));
    await waitFor(() => expect(submitVideoFeedback).toHaveBeenCalledWith(
      "token", 402, 7, "accepted",
    ));
    fireEvent.click(screen.getByRole("button", { name: "我已发布" }));
    await waitFor(() => expect(submitVideoFeedback).toHaveBeenCalledWith(
      "token", 402, 7, "published",
    ));
  });

  it("does not ask for publishability before a current MP4 exists", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const product = { ...base, backendAssetId: 402,
      versions: [{ id: "7", label: "v1", savedAt: "现在", status: "初始版本" }] };
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn(async () => undefined)}
      onSaveProduct={vi.fn(async () => undefined)} product={product}
      selectedConversation={conversationForDisplayProduct(product)} token="token" />);
    expect(screen.queryByRole("button", { name: "这版可以发布" })).not.toBeInTheDocument();
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
