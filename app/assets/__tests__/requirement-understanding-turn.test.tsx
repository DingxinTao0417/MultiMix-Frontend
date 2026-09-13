// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import RequirementUnderstandingTurn from "../components/requirement-understanding-turn";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { ProjectRequirementSnapshot } from "../lib/asset-workspace-types";

function snapshot(conversationText: string): ProjectRequirementSnapshot {
  return {
    id: "snapshot-3",
    conversationId: "project-1",
    version: 3,
    parentSnapshotId: "snapshot-2",
    status: "needs_confirmation",
    triggerKind: "source_added",
    conversationText,
    conversationMedia: [],
    payload: {
      schemaVersion: "project_requirement_snapshot_v1",
      summary: "制作门店活动短片",
      goal: "推广活动",
      audience: "周边顾客",
      intent: { operation: "supplement", scope: "project_default", targetItemIds: [], replacementSourceAssetId: null },
      deliverables: [], facts: [], requirements: [], assetUsages: [], conflicts: [], sourceAssetIds: [31],
      diff: { addedItemIds: [], removedItemIds: [], changedItemIds: [], newConflictIds: [], resolvedConflictIds: [], usageChangedAssetIds: [] },
    },
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-09-13T08:00:00Z",
    completedAt: "2026-09-13T08:00:01Z",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubObjectUrls(value: string) {
  const NativeURL = globalThis.URL;
  vi.stubGlobal("URL", Object.assign(
    class extends NativeURL {},
    {
      createObjectURL: vi.fn(() => value),
      revokeObjectURL: vi.fn(),
    },
  ));
}

describe("conversation-native requirement understanding", () => {
  it("renders the understanding as an ordinary assistant turn without a card, form, or direct action", () => {
    render(
      <RequirementUnderstandingTurn
        snapshot={snapshot(
          "我理解的是：制作门店活动短片。\n\n我发现两份资料中的价格不一致。请直接回复采用哪一份。",
        )}
      />,
    );

    const turn = screen.getByLabelText("Agent 对项目需求的理解");
    expect(turn.tagName).toBe("ARTICLE");
    expect(turn).toHaveClass("assistant");
    expect(screen.getByText(/我理解的是：制作门店活动短片/)).toBeVisible();
    expect(screen.getByText(/请直接回复采用哪一份/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector("aside")).not.toBeInTheDocument();
    expect(document.querySelector(".shadcn-prototype-requirement-card")).not.toBeInTheDocument();
  });

  it("downloads and renders screenshot evidence inside the ordinary Agent turn", async () => {
    stubObjectUrls("blob:requirement-evidence-31");
    vi.spyOn(assetWorkspaceAdapter, "downloadAsset").mockResolvedValue(
      new Blob(["image"], { type: "image/png" }),
    );
    const value = snapshot("我发现截图里的活动价与报价表不一致，请直接告诉我采用哪一项。");
    value.conversationMedia = [{
      kind: "image_evidence",
      assetId: 31,
      anchor: "image:region-2",
      quote: "活动价改为 129 元",
    }];

    render(<RequirementUnderstandingTurn snapshot={value} token="token" />);

    const image = await screen.findByRole("img", { name: "对话中引用的图片证据" });
    expect(image).toHaveAttribute("src", "blob:requirement-evidence-31");
    expect(screen.getByText("image:region-2")).toBeVisible();
    expect(screen.getByText("活动价改为 129 元")).toBeVisible();
    expect(screen.queryByText("客户聊天截图.png")).not.toBeInTheDocument();
    expect(assetWorkspaceAdapter.downloadAsset).toHaveBeenCalledWith("token", 31);
  });

  it("renders persisted message image evidence in the same chronological reply", async () => {
    stubObjectUrls("blob:persisted-requirement-evidence-31");
    vi.spyOn(assetWorkspaceAdapter, "downloadAsset").mockResolvedValue(
      new Blob(["image"], { type: "image/png" }),
    );
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "project-image-evidence",
      detailsLoaded: true,
      messages: [{
        role: "assistant" as const,
        text: "截图里的活动价与报价表不一致，请直接回复采用哪一项。",
        metadata: {
          requirement_snapshot_id: "snapshot-3",
          requirement_evidence_media: [{
            kind: "image_evidence",
            asset_id: 31,
            anchor: "image:region-2",
            quote: "活动价改为 129 元",
          }],
        },
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        requirementAnalyticsToken="token"
      />,
    );

    const reply = screen.getByText(/截图里的活动价与报价表不一致/).closest("article");
    expect(reply).not.toBeNull();
    expect(await screen.findByRole("img", { name: "对话中引用的图片证据" })).toBeVisible();
    expect(reply).toContainElement(screen.getByRole("img", { name: "对话中引用的图片证据" }));
    expect(screen.queryByText("客户聊天截图.png")).not.toBeInTheDocument();
  });
});
