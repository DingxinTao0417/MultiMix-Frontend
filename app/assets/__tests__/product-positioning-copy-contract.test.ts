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
  test("accepts long-form sources through the chat composer", () => {
    expect(conversationStart).toContain("PDF / 图片 / 视频素材");
    expect(conversationStart).toContain('aria-label="上传视频素材"');
    expect(conversationStart).toContain("也可粘贴视频链接");
    expect(conversationStart).not.toContain("视频请先上传到视频素材库");
  });

  test("documents the requirement gate for long-form analysis", () => {
    expect(workspaceDesign).toContain("长视频文件和受支持的视频链接从对话输入框加入");
    expect(workspaceDesign).toContain("只有用户明确提交处理需求后才启动长内容分析");
    expect(workspaceDesign).not.toContain("视频先上传到视频素材库，再加入对话或直接发起视频创作");
  });
});
