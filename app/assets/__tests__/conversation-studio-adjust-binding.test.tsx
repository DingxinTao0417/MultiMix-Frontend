// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
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
});
