// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import type { AssetConversation, AssetProduct } from "../lib/asset-workspace-types";

const director: AssetProduct = {
  id: "asset-director-1254",
  backendAssetId: 1254,
  contentType: "video_script",
  mode: "video",
  title: "护发膏编导稿",
  status: "完成",
  summary: "4 镜护发膏讲解",
  ratio: "16:9",
  duration: "18 秒",
  phase: "编导稿",
  sections: [],
  timeline: [],
  actions: ["调整分镜"],
};

const conversation: AssetConversation = {
  id: "asset-conversation-1",
  detailsLoaded: true,
  title: "护发膏讲解",
  type: "llm-generation",
  updatedAt: "刚刚",
  assetLabel: "对话产物",
  status: "active",
  prompt: "",
  response: "",
  canvasTitle: director.title,
  canvasMeta: "",
  raw: "",
  judgment: "",
  action: "",
  delivery: "",
  suggestions: [],
  messages: [{
    role: "assistant",
    text: "已生成编导稿。",
    assetId: 1254,
    suggestions: ["调整分镜"],
  }],
  product: director,
  products: [director],
};

describe("ConversationStudio storyboard adjustment binding", () => {
  it("selects the suggestion card's director draft before prefilling the adjustment", () => {
    const onSelectProduct = vi.fn();

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation}
        selectedProduct={null}
        onSelectProduct={onSelectProduct}
        onSendMessage={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "调整分镜" }));

    expect(onSelectProduct).toHaveBeenCalledWith(conversation.id, director.id);
    expect(screen.getByRole("textbox", { name: "输入对话内容" })).toHaveValue("调整分镜");
  });

  it("binds a confirmation-card revision without copying the button label into the instruction", async () => {
    const onSelectProduct = vi.fn();
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const confirmationConversation: AssetConversation = {
      ...conversation,
      id: "asset-conversation-confirmation-adjust",
      messages: [{
        role: "assistant",
        text: "请确认视频方案。",
        assetId: 1254,
        plan: {
          kind: "video_project_confirmation",
          title: "确认视频方案",
          status: "pending",
          fields: [],
          confirmLabel: "确认生成",
          adjustLabel: "调整方案",
          directorAssetId: 1254,
        },
      }],
    };

    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={confirmationConversation}
        selectedProduct={null}
        onSelectProduct={onSelectProduct}
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "调整方案" }));

    expect(onSelectProduct).toHaveBeenCalledWith(confirmationConversation.id, director.id);
    const composer = screen.getByRole("textbox", { name: "输入对话内容" });
    expect(composer).toHaveValue("");
    expect(composer).toHaveAttribute("placeholder", expect.stringContaining("说说想怎么调整"));

    fireEvent.change(composer, { target: { value: "请把第 1 镜改得更简洁" } });
    fireEvent.submit(composer.closest("form")!);

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(onSendMessage.mock.calls[0]?.[1]).toBe("请把第 1 镜改得更简洁");
    expect(onSendMessage.mock.calls[0]?.[13]).toBe(1254);
  });
});
