// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  CHAT_IMAGE_UPLOAD_ACCEPT,
  CHAT_SOURCE_UPLOAD_ACCEPT,
  chatAttachmentRejectionMessage,
  partitionChatAttachmentFiles,
} from "../lib/chat-attachment-policy";

const file = (name: string, type: string) => new File(["content"], name, { type });

describe("chat attachment policy", () => {
  it("accepts images and supported documents", () => {
    const image = file("cover.png", "image/png");
    const pdf = file("brief.pdf", "application/pdf");

    expect(partitionChatAttachmentFiles([image, pdf])).toEqual({
      acceptedFiles: [image, pdf],
      rejectedVideoCount: 0,
      rejectedUnsupportedCount: 0,
    });
    expect(CHAT_IMAGE_UPLOAD_ACCEPT).toBe("image/png,image/jpeg,image/webp");
    expect(CHAT_SOURCE_UPLOAD_ACCEPT).toBe(
      ".pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm",
    );
  });

  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.pdf", "video/mp4"],
    ["clip.mov", ""],
    ["clip.webm", "application/octet-stream"],
    ["clip.mkv", ""],
  ])("rejects chat video %s", (name, type) => {
    const partition = partitionChatAttachmentFiles([file(name, type)]);

    expect(partition.acceptedFiles).toEqual([]);
    expect(partition.rejectedVideoCount).toBe(1);
    expect(chatAttachmentRejectionMessage(partition)).toBe(
      "对话暂不支持视频附件，请先上传到视频素材库。",
    );
  });

  it("keeps supported files from a mixed selection and reports every rejected class", () => {
    const image = file("cover.png", "image/png");
    const partition = partitionChatAttachmentFiles([
      image,
      file("clip.mp4", "video/mp4"),
      file("archive.zip", "application/zip"),
    ]);

    expect(partition.acceptedFiles).toEqual([image]);
    expect(chatAttachmentRejectionMessage(partition)).toBe(
      "对话暂不支持视频附件，请先上传到视频素材库。 暂不支持该附件格式。",
    );
  });
});
