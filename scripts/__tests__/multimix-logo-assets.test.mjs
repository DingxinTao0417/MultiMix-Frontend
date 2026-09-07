import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";

const root = process.cwd();
const brandDir = path.join(root, "public", "brand");
const variants = [
  ["multimix-logo-horizontal-black.svg", "#151515"],
  ["multimix-logo-horizontal-white.svg", "#FFFFFF"],
  ["multimix-logo-icon-black.svg", "#151515"],
  ["multimix-logo-icon-white.svg", "#FFFFFF"],
];

function pngMetadata(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

test("SVG masters are portable path-only black/white assets", async () => {
  for (const [filename, color] of variants) {
    const svg = await readFile(path.join(brandDir, filename), "utf8");
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, new RegExp(color, "i"));
    assert.doesNotMatch(svg, /<(text|image|foreignObject)\b/i);
    assert.doesNotMatch(svg, /(font-family|filter=|linearGradient|radialGradient)/i);
    assert.match(svg, /data-part="mark"/);
    if (filename.includes("horizontal")) assert.match(svg, /data-part="wordmark"/);
  }
});

test("the forward arrow keeps visible negative space from the M", async () => {
  const svg = await readFile(path.join(brandDir, "multimix-logo-icon-black.svg"), "utf8");
  assert.match(
    svg,
    /<path data-part="forward-arrow" d="M164 63l20 33-20 33" stroke-width="12"\/>/,
  );
});

test("brand kit manifest and archive publish the approved reusable assets", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(brandDir, "brand-kit-manifest.json"), "utf8"),
  );
  assert.equal(manifest.version, "multimix-brand-showcase:v1");
  assert.deepEqual(manifest.colors, { black: "#151515", white: "#FFFFFF" });
  assert.deepEqual(manifest.watermark, {
    preferred: "bottom-right",
    widthAt1080ShortEdge: 160,
    marginAt1080ShortEdge: 28,
  });
  for (const filename of manifest.files) await access(path.join(brandDir, filename));

  const zip = await readFile(path.join(brandDir, "multimix-brand-kit.zip"));
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  for (const filename of manifest.files) {
    assert.ok(zip.includes(Buffer.from(filename)), `${filename} must be present in the brand kit`);
  }
});

test("PNG exports have exact dimensions and transparent corners", async () => {
  const expected = new Map([
    ["multimix-logo-horizontal-black.png", [1800, 480]],
    ["multimix-logo-horizontal-white.png", [1800, 480]],
    ["multimix-logo-icon-black.png", [1024, 1024]],
    ["multimix-logo-icon-white.png", [1024, 1024]],
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [filename, [width, height]] of expected) {
      const buffer = await readFile(path.join(brandDir, filename));
      assert.deepEqual(pngMetadata(buffer), { width, height, colorType: 6 });
      const src = `data:image/png;base64,${buffer.toString("base64")}`;
      const alpha = await page.evaluate(async (imageSrc) => {
        const image = new Image();
        image.src = imageSrc;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 1, 1).data[3];
      }, src);
      assert.equal(alpha, 0, `${filename} must have a transparent corner`);
    }
  } finally {
    await browser.close();
  }
});

test("preview sheet is a 1920x1080 PNG", async () => {
  const buffer = await readFile(path.join(brandDir, "multimix-logo-preview.png"));
  const metadata = pngMetadata(buffer);
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
});
