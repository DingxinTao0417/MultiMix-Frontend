import { describe, expect, it } from "vitest";

import {
  attachmentSendBlockReason,
  chatAttachmentFileKind,
  chatAttachmentStatusLabel,
} from "../lib/asset-workspace-shared";

describe("chat attachment upload state", () => {
  it("routes supported video files to the video library", () => {
    expect(chatAttachmentFileKind(new File(["video"], "clip.mp4", { type: "video/mp4" }))).toBe("video");
    expect(chatAttachmentFileKind(new File(["video"], "clip.mov", { type: "video/quicktime" }))).toBe("video");
    expect(chatAttachmentFileKind(new File(["video"], "clip.webm", { type: "video/webm" }))).toBe("video");
    expect(chatAttachmentFileKind(new File(["video"], "clip.mkv", { type: "video/x-matroska" }))).toBe("video");
  });

  it("shows an actual percentage only while transfer is in flight", () => {
    expect(chatAttachmentStatusLabel({ status: "uploading", uploadProgress: 37 })).toBe("上传中 37%");
    expect(chatAttachmentStatusLabel({ status: "uploading", uploadProgress: null })).toBe("上传中");
  });

  it("presents a server-accepted asset as uploaded without exposing parsing progress", () => {
    expect(chatAttachmentStatusLabel({ status: "processing", uploadProgress: 100 })).toBe("上传完成");
    expect(chatAttachmentStatusLabel({ status: "ready", uploadProgress: 100 })).toBe("上传完成");
    expect(attachmentSendBlockReason([{ status: "processing" }])).toBe("资料正在准备，暂不可发送。");
  });
});
