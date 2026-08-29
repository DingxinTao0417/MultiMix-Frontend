import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const conversationStart = readFileSync(
  new URL("../components/conversation-start.tsx", import.meta.url),
  "utf8",
);
const workspaceDesign = readFileSync(
  new URL("../../../docs/MULTIMIX_WORKSPACE_DESIGN.md", import.meta.url),
  "utf8",
);

describe("material-driven product positioning copy", () => {
  test("does not promise video as a direct chat attachment", () => {
    expect(conversationStart).not.toContain("PDF / 图片 / 视频素材");
    expect(conversationStart).toContain("PDF / 图片");
    expect(conversationStart).toContain("视频请先上传到视频素材库");
  });

  test("keeps the authority document consistent with the video-library entry", () => {
    expect(workspaceDesign).not.toContain("用户可以在对话里上传图片、视频和文档");
    expect(workspaceDesign).toContain("视频先上传到视频素材库，再加入对话或直接发起视频创作");
    expect(workspaceDesign).toContain("对话附件当前支持 PDF、Excel、纯文本、Markdown、HTML 和图片，不支持 PPT / Word，也不接收视频");
  });
});
