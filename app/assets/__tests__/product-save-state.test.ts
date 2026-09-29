import { describe, expect, it, vi } from "vitest";
import { reconcileSavedProduct, runExclusiveProductSave, savedVersionForProduct } from "../lib/product-save-state";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

const base = { ...displayProducts["case-07-project-ready-mp4"], id: "asset-1", backendAssetId: 1,
  backendUpdatedAt: "2026-09-29T01:00:00Z", version: "v1" };
const saved = { ...base, backendUpdatedAt: "2026-09-29T01:01:00Z", version: "v2",
  versions: [{ id: "2", label: "v2", savedAt: "刚刚", status: "已保存" }] };

describe("product checkpoint reconciliation", () => {
  it("updates the product and its history together", () => {
    const conversation = conversationForDisplayProduct(base);
    const result = reconcileSavedProduct([conversation], conversation.id, base, saved);
    expect(result[0].product).toEqual(saved);
    expect(result[0].products).toContainEqual(saved);
    expect(result[0].product.versions?.[0].label).toBe("v2");
  });
  it("does not replace a newer product or another identity with a late response", () => {
    const conversation = conversationForDisplayProduct({ ...base, backendUpdatedAt: "newer" });
    const current = [conversation];
    expect(reconcileSavedProduct(current, conversation.id, base, saved)).toBe(current);
    expect(reconcileSavedProduct(current, "another-conversation", base, saved)).toBe(current);
    expect(reconcileSavedProduct([conversationForDisplayProduct(base)], conversation.id, base,
      { ...saved, backendAssetId: 2 })).not.toContainEqual(saved);
  });
  it("does not carry saved feedback to a later server update", () => {
    const feedback = { version: "v2", updatedAt: saved.backendUpdatedAt };
    expect(savedVersionForProduct(saved, feedback)).toBe("v2");
    expect(savedVersionForProduct(base, feedback)).toBeUndefined();
    expect(savedVersionForProduct({ ...saved, version: "v3" }, feedback)).toBeUndefined();
    expect(savedVersionForProduct({ ...saved, backendUpdatedAt: undefined }, feedback)).toBeUndefined();
  });
  it("suppresses duplicate requests synchronously and releases on failure", async () => {
    const inFlight = new Set<string>();
    let reject!: (error: Error) => void;
    const operation = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const first = runExclusiveProductSave(inFlight, base.id, operation);
    expect(await runExclusiveProductSave(inFlight, base.id, operation)).toBe(false);
    expect(operation).toHaveBeenCalledOnce();
    reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    expect(inFlight.size).toBe(0);
    expect(await runExclusiveProductSave(inFlight, base.id, async () => undefined)).toBe(true);
  });
});
