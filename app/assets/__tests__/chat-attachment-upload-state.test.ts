import { describe, expect, it } from "vitest";

import {
  attachmentSendBlockReason,
  chatAttachmentFileKind,
  chatAttachmentStatusLabel,
  pendingAttachmentReconciliationKeys,
  shouldImmediatelyReconcileAcceptedUpload,
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

  it("reconciles every accepted processing attachment exactly once by stable key", () => {
    expect(pendingAttachmentReconciliationKeys({
      new: [
        { id: "pdf", assetId: 668, status: "processing" },
        { id: "done", assetId: 669, status: "ready" },
      ],
      "asset-conversation-a": [
        { id: "image", assetId: 670, status: "processing" },
        { id: "unaccepted", status: "processing" },
      ],
    })).toEqual([
      { key: "new:pdf:668", conversationId: "new", uploadId: "pdf", assetId: 668 },
      { key: "asset-conversation-a:image:670", conversationId: "asset-conversation-a", uploadId: "image", assetId: 670 },
    ]);
  });

  it("immediately reconciles every accepted processing attachment that can race its state subscription", () => {
    expect(shouldImmediatelyReconcileAcceptedUpload({
      assetId: 823,
      fileKind: "source",
      status: "processing",
    })).toBe(true);
    expect(shouldImmediatelyReconcileAcceptedUpload({
      assetId: 824,
      fileKind: "image",
      status: "processing",
    })).toBe(true);
    expect(shouldImmediatelyReconcileAcceptedUpload({
      assetId: 823,
      fileKind: "source",
      status: "ready",
    })).toBe(false);
  });
});
