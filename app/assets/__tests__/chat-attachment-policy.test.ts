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
  ])("accepts chat video %s", (name, type) => {
    const video = file(name, type);
    const partition = partitionChatAttachmentFiles([video]);

    expect(partition.acceptedFiles).toEqual([video]);
    expect(chatAttachmentRejectionMessage(partition)).toBeNull();
  });

  it("rejects video containers outside the supported long-form formats", () => {
    const partition = partitionChatAttachmentFiles([
      file("legacy.avi", "video/x-msvideo"),
    ]);

    expect(partition.acceptedFiles).toEqual([]);
    expect(chatAttachmentRejectionMessage(partition)).toBe("暂不支持该附件格式。");
  });

  it("keeps supported files from a mixed selection and reports every rejected class", () => {
    const image = file("cover.png", "image/png");
    const partition = partitionChatAttachmentFiles([
      image,
      file("clip.mp4", "video/mp4"),
      file("archive.zip", "application/zip"),
    ]);

    expect(partition.acceptedFiles).toHaveLength(2);
    expect(partition.acceptedFiles[0]).toBe(image);
    expect(partition.acceptedFiles[1]?.name).toBe("clip.mp4");
    expect(chatAttachmentRejectionMessage(partition)).toBe(
      "暂不支持该附件格式。",
    );
  });
});
