import { describe, expect, it } from "vitest";

import { resolveConversationDisplayProduct, resolveConversationStageProducts, shouldReviseSelectedProduct } from "../lib/asset-workspace-shared";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

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

describe("conversation display product selection", () => {
  const stable = displayProducts["case-06-project-ready-no-mp4"];
  const running = displayProducts["case-04-project-running"];
  const failed = displayProducts["case-05-project-failed"];

  it.each([running, failed])("keeps a first $productStatus product in the conversation only", (product) => {
    expect(resolveConversationDisplayProduct(conversationForDisplayProduct(product), product.id)).toBeNull();
  });

  it("falls back to the last stable product when the selected new product is unfinished", () => {
    const conversation = {
      ...conversationForDisplayProduct(running),
      products: [stable, running],
    };
    expect(resolveConversationDisplayProduct(conversation, running.id)).toEqual(stable);
    expect(resolveConversationStageProducts(conversation, running.id)).toEqual({
      selectedProduct: stable,
      displayProduct: stable,
    });
  });

  it("retains the unfinished record for conversation guidance when no stable product exists", () => {
    expect(resolveConversationStageProducts(conversationForDisplayProduct(failed), failed.id)).toEqual({
      selectedProduct: failed,
      displayProduct: null,
    });
  });

  it("keeps a completed video visible when its latest local operation failed", () => {
    const completedWithFailedOperation = {
      ...stable,
      operationStatus: "failed" as const,
      operationFailureReason: "修改失败，上一版仍可使用。",
    };
    expect(resolveConversationDisplayProduct(
      conversationForDisplayProduct(completedWithFailedOperation),
      completedWithFailedOperation.id,
    )).toEqual(completedWithFailedOperation);
  });

  it("keeps a persisted, editor-ready project inspectable when a later required effect fails", () => {
    const projectWithFailedEffect = {
      ...stable,
      productStatus: "failed" as const,
      videoProductCompleted: false,
      videoProjectReady: true,
      contentType: "video_project",
    };
    expect(resolveConversationDisplayProduct(
      conversationForDisplayProduct(projectWithFailedEffect),
      projectWithFailedEffect.id,
    )).toEqual(projectWithFailedEffect);
  });

  it("does not treat an invalid legacy video record as a completed output", () => {
    const invalid = {
      ...running,
      productStatus: undefined,
      videoProjectReady: false,
      videoProductCompleted: false,
      contentType: "video_project",
    };
    expect(resolveConversationDisplayProduct(conversationForDisplayProduct(invalid), invalid.id)).toBeNull();
  });
});
