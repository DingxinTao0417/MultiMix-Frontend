import {
  drawBrandShowcaseLogo,
  loadBrandShowcaseLogo,
} from "@/lib/brand-showcase";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type BrandImageCanvas = HTMLCanvasElement;

export type BrandImageOptions = {
  sourceType?: string;
  logo?: ImageBitmap;
  loadLogo?: () => Promise<ImageBitmap>;
  decodeImage?: (source: Blob) => Promise<ImageBitmap>;
  createCanvas?: (width: number, height: number) => BrandImageCanvas;
};

function defaultCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("canvas export failed")),
      type,
      type === "image/jpeg" || type === "image/webp" ? 0.92 : undefined,
    );
  });
}

export async function createBrandedImageBlob(
  source: Blob,
  options: BrandImageOptions = {},
): Promise<Blob> {
  const sourceType = (options.sourceType || source.type).toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(sourceType)) {
    throw new Error("当前图片格式暂不支持品牌展示版，请下载原图。");
  }

  let sourceImage: ImageBitmap | null = null;
  try {
    sourceImage = await (options.decodeImage ?? createImageBitmap)(source);
    if (sourceImage.width <= 0 || sourceImage.height <= 0) throw new Error("invalid image size");
    const logo = options.logo ?? await (options.loadLogo ?? loadBrandShowcaseLogo)();
    const canvas = (options.createCanvas ?? defaultCanvas)(sourceImage.width, sourceImage.height);
    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas context unavailable");
    context.drawImage(sourceImage, 0, 0);
    drawBrandShowcaseLogo(context, sourceImage.width, sourceImage.height, logo);
    return await canvasBlob(canvas, sourceType);
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("当前图片格式暂不支持")) throw cause;
    throw new Error("品牌展示版生成失败，请重试。", { cause });
  } finally {
    sourceImage?.close();
  }
}
