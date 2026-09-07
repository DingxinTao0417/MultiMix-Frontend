export type ExportVariant = "original" | "brand_showcase";

export const BRAND_SHOWCASE_SPEC_VERSION = "multimix-brand-showcase:v1";
export const BRAND_SHOWCASE_LOGO_URL = "/brand/multimix-logo-horizontal-white.png";

export type BrandShowcasePlacement = {
  width: number;
  right: number;
  bottom: number;
};

export type BrandShowcaseCanvas = OffscreenCanvas | HTMLCanvasElement;
export type BrandShowcaseFrameDecorator = (
  canvas: BrandShowcaseCanvas,
) => void | Promise<void>;

export function brandShowcasePlacement(
  width: number,
  height: number,
): BrandShowcasePlacement {
  const scale = Math.min(width, height) / 1080;
  return {
    width: Math.max(1, Math.round(160 * scale)),
    right: Math.max(1, Math.round(28 * scale)),
    bottom: Math.max(1, Math.round(28 * scale)),
  };
}

export function brandShowcaseFilename(
  filename: string,
  exportVariant: ExportVariant,
): string {
  if (exportVariant === "original") return filename;
  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex <= 0) return `${filename}-multimix-brand`;
  return `${filename.slice(0, extensionIndex)}-multimix-brand${filename.slice(extensionIndex)}`;
}

export async function loadBrandShowcaseLogo(
  fetchImpl: typeof fetch = fetch,
): Promise<ImageBitmap> {
  const response = await fetchImpl(BRAND_SHOWCASE_LOGO_URL);
  if (!response.ok) throw new Error("MultiMix 品牌标识加载失败，请重试。");
  try {
    return await createImageBitmap(await response.blob());
  } catch {
    throw new Error("MultiMix 品牌标识加载失败，请重试。");
  }
}

export function drawBrandShowcaseLogo(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  logo: ImageBitmap,
): void {
  if (logo.width <= 0 || logo.height <= 0) {
    throw new Error("MultiMix 品牌标识尺寸无效，请重试。");
  }
  const placement = brandShowcasePlacement(canvasWidth, canvasHeight);
  const logoHeight = Math.max(1, Math.round(placement.width * logo.height / logo.width));
  const x = canvasWidth - placement.right - placement.width;
  const y = canvasHeight - placement.bottom - logoHeight;
  const scale = Math.min(canvasWidth, canvasHeight) / 1080;

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.45)";
  context.shadowBlur = Math.max(2, Math.round(8 * scale));
  context.shadowOffsetX = 0;
  context.shadowOffsetY = Math.max(1, Math.round(2 * scale));
  context.globalAlpha = 1;
  context.drawImage(logo, x, y, placement.width, logoHeight);
  context.restore();
}

export function createBrandShowcaseFrameDecorator(
  loadLogo: () => Promise<ImageBitmap> = loadBrandShowcaseLogo,
): BrandShowcaseFrameDecorator {
  const logoPromise = loadLogo();
  return async (canvas) => {
    const logo = await logoPromise;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("品牌展示版生成失败，请重试。");
    drawBrandShowcaseLogo(
      context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      canvas.width,
      canvas.height,
      logo,
    );
  };
}
