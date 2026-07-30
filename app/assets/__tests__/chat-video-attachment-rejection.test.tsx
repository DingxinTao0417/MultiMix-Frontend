// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

function conversation() {
  return {
    ...assetWorkspaceAdapter.getNewConversation(),
    id: "conversation-1",
    detailsLoaded: true,
    readonly: false,
  };
}

const video = () => new File(["video"], "clip.mp4", { type: "video/mp4" });
const image = () => new File(["image"], "cover.png", { type: "image/png" });

describe("chat video attachment rejection", () => {
  it("rejects video in a new conversation while uploading the supported image", () => {
    const onUploadImages = vi.fn();
    render(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onUploadImages={onUploadImages}
      />,
    );

    const imageFile = image();
    fireEvent.drop(screen.getByLabelText("新建对话"), {
      dataTransfer: { files: [video(), imageFile] },
    });

    expect(onUploadImages).toHaveBeenCalledWith([imageFile]);
    expect(
      screen.getByText("对话暂不支持视频附件，请先上传到视频素材库。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeInTheDocument();
  });

  it("rejects video in an existing conversation while uploading the supported image", () => {
    const onUploadImages = vi.fn();
    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onUploadImages={onUploadImages}
        readonly={false}
      />,
    );

    const imageFile = image();
    fireEvent.drop(screen.getByLabelText("Content generation conversation"), {
      dataTransfer: { files: [video(), imageFile] },
    });

    expect(onUploadImages).toHaveBeenCalledWith([imageFile]);
    expect(
      screen.getByText("对话暂不支持视频附件，请先上传到视频素材库。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeInTheDocument();
  });
});
