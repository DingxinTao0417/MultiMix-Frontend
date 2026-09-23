// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssetConversationResponse } from "../../../lib/api";
import { conversationFromPersisted } from "../../../lib/asset-mappers";
import ConversationStudio from "../components/conversation-studio";
import ProjectResourcesDrawer from "../components/project-resources-drawer";
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

  it("shows a compact project resource entry in the chat title only when the project has resources", () => {
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

    const resourceEntry = screen.getByRole("button", { name: "项目资料，共 4 项" });
    expect(resourceEntry).toHaveTextContent("资料4");
    expect(screen.queryByText("素材 1")).not.toBeInTheDocument();
  });

  it("hides project resource management until the project has resources", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "asset-conversation-empty-project",
      title: "空白项目",
      detailsLoaded: true,
      projectResources: { sources: [], copies: [], covers: [], videos: [] },
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onOpenProjectResources={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /项目资料/ })).not.toBeInTheDocument();
    expect(screen.queryByText("资料")).not.toBeInTheDocument();
  });

  it("keeps project resources in the chat title without adding a row above the message thread", () => {
    const conversation = {
      ...assetWorkspaceAdapter.getNewConversation(),
      id: "asset-conversation-project",
      title: "产品讲解视频",
      detailsLoaded: true,
      projectResources: {
        sources: [{ id: "11", title: "产品实拍" }],
        copies: [],
        covers: [],
        videos: [],
      },
      agentTasks: {
        active: { goal: "生成讲解编导稿", status: "running" },
        paused: [],
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

    const studio = screen.getByLabelText("Content generation conversation");
    expect(studio.children).toHaveLength(3);
    expect(studio.children[0]).toHaveClass("shadcn-prototype-chat-context");
    const header = within(studio.children[0] as HTMLElement).getByRole("button", { name: "项目资料，共 1 项" }).closest("header");
    expect(header).toHaveClass("shadcn-prototype-chat-head");
    expect(within(header as HTMLElement).getByRole("button", { name: "项目资料，共 1 项" })).toHaveTextContent("资料1");
    expect(within(studio.children[0] as HTMLElement).getByRole("complementary", { name: "Agent 任务状态" })).toBeInTheDocument();
    expect(studio.children[1]).toHaveClass("shadcn-prototype-thread");
    expect(studio.children[2]).toHaveClass("shadcn-prototype-composer");
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

  it("keeps Agent understanding out of the resource drawer while management actions remain", async () => {
    const onPermanentDeleteSource = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectResourcesDrawer
        open
        projectTitle="品牌短片"
        summary={{ sources: 1, historicalSources: 0, copies: 0, covers: 0, videos: 0 }}
        loadResources={vi.fn().mockResolvedValue({
          items: [{
            id: 31,
            title: "品牌手册.pptx",
            kind: "source",
            membershipState: "active",
            historicalReferenceCount: 0,
            status: "ready",
            assetKind: "asset",
            contentType: "knowledge",
            sourceType: "upload",
            updatedAt: "2026-09-12T08:00:00Z",
            contentRole: "brand_identity",
            usePolicy: "do_not_use",
          }],
          total: 1,
          offset: 0,
          limit: 20,
        })}
        onClose={vi.fn()}
        onRemoveSource={vi.fn()}
        onReaddSource={vi.fn()}
        onOpenResource={vi.fn()}
        onPermanentDeleteSource={onPermanentDeleteSource}
      />,
    );

    expect(await screen.findByText("品牌手册.pptx")).toBeVisible();
    expect(screen.queryByText("素材角色")).not.toBeInTheDocument();
    expect(screen.queryByText("使用方式")).not.toBeInTheDocument();
    expect(screen.queryByText("品牌身份")).not.toBeInTheDocument();
    expect(screen.queryByText("不可用于成片")).not.toBeInTheDocument();
    expect(screen.queryByText("需要调整时，直接在项目对话里告诉 Agent。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移出项目" })).toBeVisible();
    fireEvent.click(screen.getByText("更多"));
    const permanentDelete = screen.getByRole("button", { name: "永久删除源文件" });
    await waitFor(() => expect(permanentDelete).not.toBeDisabled());
    fireEvent.click(permanentDelete);
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onPermanentDeleteSource).toHaveBeenCalledWith(31));
  });
});
