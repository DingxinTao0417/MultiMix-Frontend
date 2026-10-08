import { describe, expect, it } from "vitest";

import { sceneImageGenerationUtterance } from "../lib/scene-source-utterance";

describe("scene image generation request", () => {
  it("states an explicit creation action and carries the saved visible scene goal", () => {
    const utterance = sceneImageGenerationUtterance({
      title: "现做早餐特写",
      visual_brief: "蒸汽从刚出锅的面点或粥碗中缓缓升起，背景虚化。",
      narration: "每一份早餐，都是此刻现做的温暖心意。",
    }, 2);
    expect(utterance).toContain("生成一张创意图片候选");
    expect(utterance).toContain("第 2 镜");
    expect(utterance).toContain("蒸汽从刚出锅的面点或粥碗中缓缓升起");
    expect(utterance).toContain("不自动应用");
    expect(utterance).not.toContain("能否执行");
  });

  it("keeps a scene with no visual brief actionable using its saved purpose", () => {
    const utterance = sceneImageGenerationUtterance({ title: "片尾邀请", narration: "欢迎来看看。" }, 6);
    expect(utterance).toContain("片尾邀请");
    expect(utterance).toContain("欢迎来看看");
  });
});
