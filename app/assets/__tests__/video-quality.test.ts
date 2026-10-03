import { describe, expect, it } from "vitest";
import { videoExportFailureMessage, type VideoQualityReport } from "../lib/video-quality";

describe("video export failure summary", () => {
  const blocked: VideoQualityReport = {
    stage: "export_file", status: "blocked", warnings: [],
    blockers: [{ code: "decode_failed", segment_id: null, object_type: "export_file",
      message: "成片无法完整解码", suggested_actions: ["重新导出"] }],
  };
  it("uses the same Chinese summary for a quality blocker", () => {
    expect(videoExportFailureMessage(blocked, "Exported video did not pass quality verification."))
      .toBe("成片未通过质量检查，请查看具体问题后重新导出。");
  });
  it("preserves non-quality failures and provides a missing-message fallback", () => {
    expect(videoExportFailureMessage(null, "上传失败")).toBe("上传失败");
    expect(videoExportFailureMessage({ ...blocked, blockers: [] }, "发布失败")).toBe("发布失败");
    expect(videoExportFailureMessage(null, null)).toBe("成片检查失败，请重试导出。");
  });
});
