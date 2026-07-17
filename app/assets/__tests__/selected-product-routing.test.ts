import { describe, expect, it } from "vitest";

import { shouldReviseSelectedProduct } from "../lib/asset-workspace-shared";

describe("selected product message routing", () => {
  const selectedProduct = { backendAssetId: 447 };

  it.each([
    "把第二段改得更口语一点",
    "能不能把第二段改得更口语一点？",
    "字幕短一点",
    "rewrite the second paragraph",
  ])("routes an explicit edit request to product revision: %s", (instruction) => {
    expect(shouldReviseSelectedProduct(instruction, selectedProduct)).toBe(true);
  });

  it.each([
    "第二段是什么？",
    "第2段口播说了什么？",
    "第二个镜头为什么这样安排？",
    "字幕是什么？",
  ])("keeps a read-only question on the conversation route: %s", (instruction) => {
    expect(shouldReviseSelectedProduct(instruction, selectedProduct)).toBe(false);
  });

  it("falls back to the conversation route without a persisted selection", () => {
    expect(shouldReviseSelectedProduct("把第二段改短一点", null)).toBe(false);
  });
});
