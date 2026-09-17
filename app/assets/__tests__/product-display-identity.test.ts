import { describe, expect, it } from "vitest";

import { getProductDisplayIdentity } from "../lib/asset-workspace-shared";
import type { AssetProduct } from "../lib/asset-workspace-types";

function product(overrides: Partial<AssetProduct> = {}): AssetProduct {
  return {
    id: "product-1",
    mode: "copy",
    title: "秋季新品发布会",
    status: "已完成",
    productStatus: "completed",
    summary: "",
    ratio: "16:9",
    duration: "30 秒",
    phase: "编导阶段",
    sections: [],
    timeline: [],
    actions: [],
    version: "v2",
    ...overrides,
  };
}

describe("product display identity", () => {
  it("prefers the explicit artifact category", () => {
    expect(getProductDisplayIdentity(product({
      mode: "image",
      contentType: "custom_image",
      metadata: { artifact_category: "封面图" },
    }))).toEqual({ label: "封面图", versionLabel: "v2", title: "封面图 · v2" });
  });

  it("falls back through content type and then mode", () => {
    expect(getProductDisplayIdentity(product({ contentType: "video_script" })).label).toBe("编导稿");
    expect(getProductDisplayIdentity(product({ mode: "image", contentType: "custom_image", metadata: {} })).label).toBe("图片");
  });

  it("never infers a category from the title", () => {
    expect(getProductDisplayIdentity(product({
      title: "封面图：秋季新品",
      contentType: "unknown",
      metadata: {},
    })).label).toBe("文案");
  });
});
