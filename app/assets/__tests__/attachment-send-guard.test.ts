import { describe, expect, it } from "vitest";

import { attachmentSendBlockReason } from "../lib/asset-workspace-shared";

describe("attachmentSendBlockReason", () => {
  it("allows sending when there are no attachments", () => {
    expect(attachmentSendBlockReason([])).toBeNull();
  });

  it("allows sending when every attachment is ready", () => {
    expect(
      attachmentSendBlockReason([{ status: "ready" }, { status: "ready" }])
    ).toBeNull();
  });

  it("blocks sending when an upload failed", () => {
    // Regression: a storage-timeout upload leaves a failed attachment with no
    // asset id; sending would silently drop the material and the agent would
    // answer as if no source was ever provided.
    const reason = attachmentSendBlockReason([{ status: "ready" }, { status: "failed" }]);
    expect(reason).toContain("上传失败");
  });

  it("blocks sending while an upload is still in flight", () => {
    expect(attachmentSendBlockReason([{ status: "uploading" }])).toBe("资料正在准备，暂不可发送。");
    expect(attachmentSendBlockReason([{ status: "processing" }])).toBe("资料正在准备，暂不可发送。");
  });

  it("prioritises the failure message over the in-flight message", () => {
    const reason = attachmentSendBlockReason([{ status: "processing" }, { status: "failed" }]);
    expect(reason).toContain("上传失败");
  });
});
