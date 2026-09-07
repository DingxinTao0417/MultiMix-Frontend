import { describe, expect, it, vi } from "vitest";

import { createBrandedImageBlob } from "../lib/brand-image-export";

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

describe("branded image export", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])(
    "keeps the %s output type and places the approved logo after the source image",
    async (sourceType) => {
      const drawImage = vi.fn();
      const context = {
        drawImage,
        save: vi.fn(),
        restore: vi.fn(),
        shadowColor: "",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        globalAlpha: 1,
      } as unknown as CanvasRenderingContext2D;
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => context),
        toBlob: (callback: BlobCallback, type?: string) => callback(new Blob(["brand"], { type })),
      } as unknown as HTMLCanvasElement;
      const sourceImage = bitmap(1080, 1200);
      const logo = bitmap(1800, 480);

      const result = await createBrandedImageBlob(new Blob(["source"], { type: sourceType }), {
        sourceType,
        logo,
        decodeImage: vi.fn(async () => sourceImage),
        createCanvas: vi.fn(() => canvas),
      });

      expect(canvas.width).toBe(1080);
      expect(canvas.height).toBe(1200);
      expect(drawImage.mock.calls[0]).toEqual([sourceImage, 0, 0]);
      expect(drawImage.mock.calls.at(-1)).toEqual([logo, 892, 1129, 160, 43]);
      expect(result.type).toBe(sourceType);
      expect(sourceImage.close).toHaveBeenCalledOnce();
    },
  );

  it("fails closed when the source cannot be decoded", async () => {
    await expect(createBrandedImageBlob(new Blob(["bad"], { type: "image/png" }), {
      sourceType: "image/png",
      logo: bitmap(1800, 480),
      decodeImage: vi.fn(async () => { throw new Error("decode failed"); }),
      createCanvas: vi.fn(),
    })).rejects.toThrow("品牌展示版生成失败");
  });

  it("rejects unsupported formats without attempting a branded download", async () => {
    const decodeImage = vi.fn();
    await expect(createBrandedImageBlob(new Blob(["gif"], { type: "image/gif" }), {
      sourceType: "image/gif",
      logo: bitmap(1800, 480),
      decodeImage,
      createCanvas: vi.fn(),
    })).rejects.toThrow("当前图片格式暂不支持品牌展示版，请下载原图");
    expect(decodeImage).not.toHaveBeenCalled();
  });
});
