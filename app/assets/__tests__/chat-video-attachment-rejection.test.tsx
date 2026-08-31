// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const readyVideoAttachment = {
  id: "video-91",
  fileName: "访谈第 12 期.mp4",
  fileKind: "video" as const,
  title: "访谈第 12 期",
  status: "ready" as const,
  assetId: 91,
};

describe("chat video attachments", () => {
  it("accepts video and image together in a new conversation", () => {
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
    const videoFile = video();
    fireEvent.drop(screen.getByLabelText("新建对话"), {
      dataTransfer: { files: [videoFile, imageFile] },
    });

    expect(onUploadImages).toHaveBeenCalledWith([videoFile, imageFile]);
    expect(screen.queryByText("对话暂不支持视频附件，请先上传到视频素材库。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeInTheDocument();
  });

  it("accepts video and image together in an existing conversation", () => {
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
    const videoFile = video();
    fireEvent.drop(screen.getByLabelText("Content generation conversation"), {
      dataTransfer: { files: [videoFile, imageFile] },
    });

    expect(onUploadImages).toHaveBeenCalledWith([videoFile, imageFile]);
    expect(screen.queryByText("对话暂不支持视频附件，请先上传到视频素材库。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeInTheDocument();
  });

  it("asks for a requirement before sending a ready video from a new conversation", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        imageAttachments={[readyVideoAttachment]}
        onSend={onSend}
        onUploadImages={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "上传视频素材" })).toBeInTheDocument();
    expect(screen.getByLabelText("长视频处理需求")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSend).not.toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("请先说明你想怎么处理这段内容。");
  });

  it("turns a supported pasted video URL into an attachment request", () => {
    const onImportVideoUrl = vi.fn();
    render(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onUploadImages={vi.fn()}
        onImportVideoUrl={onImportVideoUrl}
      />,
    );

    fireEvent.paste(screen.getByLabelText("输入对话内容"), {
      clipboardData: { getData: () => "https://youtu.be/abc123" },
    });

    expect(onImportVideoUrl).toHaveBeenCalledWith("https://youtu.be/abc123");
    expect(screen.getByLabelText("输入对话内容")).toHaveValue("");
  });

  it("asks for a requirement before sending a ready video from an existing conversation", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        imageAttachments={[readyVideoAttachment]}
        onSendMessage={onSendMessage}
        onUploadImages={vi.fn()}
        readonly={false}
      />,
    );

    expect(screen.getByRole("button", { name: "上传视频素材" })).toBeInTheDocument();
    expect(screen.getByLabelText("长视频处理需求")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSendMessage).not.toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("请先说明你想怎么处理这段内容。");
  });
});
