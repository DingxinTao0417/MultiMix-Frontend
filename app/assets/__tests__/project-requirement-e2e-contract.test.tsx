// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiErrorStatus } from "../../../lib/api";
import ProjectResourcesDrawer from "../components/project-resources-drawer";
import RequirementUnderstandingTurn from "../components/requirement-understanding-turn";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

function rawSnapshot(
  status: "ready" | "needs_confirmation" = "needs_confirmation",
  withImageEvidence = false,
) {
  return {
    id: "snapshot-3",
    conversation_id: "project-1",
    version: 3,
    parent_snapshot_id: "snapshot-2",
    status,
    trigger_kind: "source_added",
    conversation_text: status === "needs_confirmation"
      ? "我理解的是：制作门店活动短片。\n\n我发现新旧价目表不一致。请直接回复采用哪一份。"
      : "我理解的是：制作门店活动短片。",
    conversation_media: withImageEvidence ? [{
      kind: "image_evidence",
      asset_id: 31,
      anchor: "image:region-2",
      quote: "活动价改为 129 元",
    }] : [],
    payload: {
      schema_version: "project_requirement_snapshot_v1",
      summary: "制作门店活动短片",
      goal: "推广活动",
      audience: "周边顾客",
      intent: { operation: "supplement", scope: "project_default", target_item_ids: [], replacement_source_asset_id: null },
      deliverables: [],
      facts: [{
        id: "price", kind: "fact", label: "活动价", value: "99 元", exact_numeric: true,
        confidence: 0.98, confirmed_by_user: false, basis: "explicit",
        evidence: [{ id: "price-new", source_asset_id: 31, anchor: "报价表 R2C3", quote: "活动价 99 元", confidence: 0.98, ocr_confidence: null }],
      }],
      requirements: [],
      asset_usages: [{
        source_asset_id: 31, content_role: "fact_evidence", use_policy: "reference_only",
        confidence: 0.98, confirmed_by_user: false, basis: "explicit", evidence: [],
      }],
      conflicts: status === "needs_confirmation" ? [{
        id: "price", conflict_type: "direct_conflict", severity: "blocking", status: "unresolved",
        summary: "新旧价目表不一致", item_ids: ["price"],
        choices: [{ label: "以新价目表为准", evidence_id: "price-new" }],
        resolution: null, basis: "explicit", evidence: [],
      }] : [],
      source_asset_ids: [31],
      diff: { added_item_ids: [], removed_item_ids: [], changed_item_ids: [], new_conflict_ids: [], resolved_conflict_ids: [], usage_changed_asset_ids: [] },
    },
    error_code: null,
    error_message: null,
    created_at: "2026-09-12T08:00:00Z",
    completed_at: "2026-09-12T08:00:01Z",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("project requirement cross-stack contract", () => {
  it("loads the server-authored Agent turn without exposing direct conflict controls", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(rawSnapshot()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = await assetWorkspaceAdapter.loadCurrentRequirements("token", "project-1");
    expect(snapshot).not.toBeNull();
    render(
      <RequirementUnderstandingTurn
        snapshot={snapshot!}
      />,
    );

    expect(screen.getByText(/我理解的是：制作门店活动短片/)).toBeVisible();
    expect(screen.getByText(/请直接回复采用哪一份/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes stale conflict identity so the workspace can reload instead of resubmitting", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: { message: "需求已更新" } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...rawSnapshot("ready"), version: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const stale = await assetWorkspaceAdapter.resolveRequirementConflict("token", "project-1", {
      snapshotId: "snapshot-3", snapshotVersion: 3, conflictId: "price",
      resolutionKind: "choose_evidence", evidenceId: "price-new",
    }).catch((error: unknown) => error);
    expect(apiErrorStatus(stale)).toBe(409);
    const current = await assetWorkspaceAdapter.loadCurrentRequirements("token", "project-1");
    expect(current?.version).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps structured image evidence without substituting an image filename", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(rawSnapshot("needs_confirmation", true)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await assetWorkspaceAdapter.loadCurrentRequirements("token", "project-1");

    expect(snapshot?.conversationMedia).toEqual([{
      kind: "image_evidence",
      assetId: 31,
      anchor: "image:region-2",
      quote: "活动价改为 129 元",
    }]);
    expect(snapshot?.conversationText).not.toContain("客户聊天截图.png");
  });

  it("keeps requirement understanding conversational while project removal and deletion stay distinct", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const permanentDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="活动短片"
        summary={{ sources: 1, historicalSources: 0, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue({
          items: [{
            id: 31, title: "竞品图.png", kind: "source", membershipState: "active",
            historicalReferenceCount: 0, status: "ready", assetKind: "image", contentType: "uploaded_image",
            sourceType: "upload", updatedAt: "2026-09-12T08:00:00Z",
            contentRole: "competitor_reference", usePolicy: "reference_only",
          }], total: 1, offset: 0, limit: 20,
        })}
        onClose={vi.fn()}
        onRemoveSource={remove}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
        onPermanentDeleteSource={permanentDelete}
      />,
    );

    expect(await screen.findByText("竞品图.png")).toBeVisible();
    expect(screen.queryByText("素材角色")).not.toBeInTheDocument();
    expect(screen.queryByText("使用方式")).not.toBeInTheDocument();
    expect(screen.queryByText("竞品参考")).not.toBeInTheDocument();
    expect(screen.queryByText("仅作参考")).not.toBeInTheDocument();
    expect(screen.queryByText("需要调整时，直接在项目对话里告诉 Agent。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移出项目" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "将素材移出项目？" })).getByRole("button", { name: "移出项目" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(31));
    await waitFor(() => expect(screen.getByRole("button", { name: "永久删除源文件" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "永久删除源文件" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "永久删除源文件？" })).getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(permanentDelete).toHaveBeenCalledWith(31));
  });
});
