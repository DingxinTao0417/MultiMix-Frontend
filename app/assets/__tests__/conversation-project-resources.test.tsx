// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssetConversationResponse } from "../../../lib/api";
import { conversationFromPersisted } from "../../../lib/asset-mappers";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

const resource = (id: number, title: string, contentType: string) => ({
  id,
  title,
  asset_kind: contentType === "video_project" ? "video" : contentType === "cover_image" ? "image" : "copy",
  content_type: contentType,
  status: "ready",
  source_type: contentType === "uploaded_image" ? "upload" : "generated",
  generation_state: "ready",
  body: "",
  metadata: {},
  source_mapping: [],
  linked_asset_ids: [],
  linked_event_ids: [],
  archived: false,
  error_message: null,
  product_status: null,
  product_completed: false,
  failure_reason: null,
  failure_action: null,
  failure_scene_id: null,
  operation_status: null,
  operation_failure_reason: null,
  operation_failure_action: null,
  operation_failure_scene_id: null,
  created_at: "2026-08-31T08:00:00Z",
  updated_at: "2026-08-31T08:00:00Z",
  versions: [],
});

describe("conversation project resources", () => {
  it("maps server-owned project resources instead of inferring them from the current product", () => {
    const source = resource(11, "产品实拍", "uploaded_image");
    const copy = resource(12, "讲解编导稿", "video_script");
    const cover = resource(13, "视频封面", "cover_image");
    const video = resource(14, "讲解视频", "video_project");
    const persisted = {
      id: "asset-conversation-project",
      title: "产品讲解视频",
      status: "active",
      metadata: {},
      messages: [],
      products: [copy, cover, video],
      project_resources: { sources: [source], copies: [copy], covers: [cover], videos: [video] },
      agent_tasks: { active: null, paused: [] },
      active_agent_action: null,
      created_at: "2026-08-31T08:00:00Z",
      updated_at: "2026-08-31T08:00:00Z",
    } as unknown as AssetConversationResponse;

    const conversation = conversationFromPersisted(
      persisted,
      assetWorkspaceAdapter.getNewConversation().product,
    );

    expect(conversation.projectResources).toEqual({
      sources: [{ id: "11", title: "产品实拍" }],
      copies: [{ id: "12", title: "讲解编导稿" }],
      covers: [{ id: "13", title: "视频封面" }],
      videos: [{ id: "14", title: "讲解视频" }],
    });
  });

  it("shows a compact project resource summary only when the project has resources", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "asset-conversation-project",
      title: "产品讲解视频",
      detailsLoaded: true,
      projectResources: {
        sources: [{ id: "11", title: "产品实拍" }],
        copies: [{ id: "12", title: "讲解编导稿" }],
        covers: [{ id: "13", title: "视频封面" }],
        videos: [{ id: "14", title: "讲解视频" }],
      },
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.getByText("项目资源")).toBeInTheDocument();
    expect(screen.getByText("素材 1")).toBeInTheDocument();
    expect(screen.getByText("文案 1")).toBeInTheDocument();
    expect(screen.getByText("封面 1")).toBeInTheDocument();
    expect(screen.getByText("视频 1")).toBeInTheDocument();
  });

  it("keeps historical version preview read-only until the user continues from it", () => {
    const source = readFileSync(
      join(process.cwd(), "app/assets/components/product-workspace.tsx"),
      "utf8",
    );

    expect(source).toContain("getContentAssetVersionPreview");
    expect(source).toContain("历史版本预览");
    expect(source).toContain("退出预览");
    expect(source).toContain("基于此版本继续");
  });
});
