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
  test("accepts video creation sources through the chat composer", () => {
    expect(conversationStart).toContain("PDF / 图片 / 视频素材");
    expect(conversationStart).toContain('aria-label="上传视频素材"');
    expect(conversationStart).toContain("也可粘贴视频链接");
    expect(conversationStart).not.toContain("视频请先上传到视频素材库");
  });

  test("documents that video upload does not create a long-form route", () => {
    expect(workspaceDesign).toContain("视频文件和受支持的视频链接从对话输入框加入");
    expect(workspaceDesign).toContain("当前不开放新增长视频拆条入口");
    expect(workspaceDesign).toContain("只在“讲解视频”和“口播优化”之间判断");
    expect(workspaceDesign).not.toContain("视频先上传到视频素材库，再加入对话或直接发起视频创作");
  });
});
