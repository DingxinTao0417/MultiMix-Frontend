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
  ["multimix-logo-badge-black.svg", "#151515"],
  ["multimix-logo-badge-white.svg", "#FFFFFF"],
];

// Pixel-accurate visible bounds; getBBox ignores stroke width in Chromium.
async function visibleBounds(page, svg) {
  return page.evaluate(async (src) => {
    const scale = 8;
    const size = 192 * scale;
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(src)))}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data;
    let minX = size;
    let minY = size;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (data[(y * size + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { minX: minX / scale, minY: minY / scale, maxX: (maxX + 1) / scale, maxY: (maxY + 1) / scale };
  }, svg);
}

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
    if (filename.includes("badge")) assert.match(svg, /data-part="plate"/);
  }
});

test("the forward arrow keeps visible negative space from the M", async () => {
  const svg = await readFile(path.join(brandDir, "multimix-logo-icon-black.svg"), "utf8");
  assert.match(
    svg,
    /<path data-part="forward-arrow" d="M164 63l20 33-20 33" stroke-width="12"\/>/,
  );
});

test("icon and badge masters stay centered with a usable safe area", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><body></body>");
    for (const filename of [
      "multimix-logo-icon-black.svg",
      "multimix-logo-icon-white.svg",
      "multimix-logo-badge-black.svg",
      "multimix-logo-badge-white.svg",
    ]) {
      const svg = await readFile(path.join(brandDir, filename), "utf8");
      const bounds = await visibleBounds(page, svg);
      const gaps = [bounds.minX, 192 - bounds.maxX, bounds.minY, 192 - bounds.maxY];
      assert.ok(
        Math.min(...gaps) >= 15,
        `${filename} needs a safe area on every edge, got ${gaps.map((gap) => gap.toFixed(2)).join("/")}`,
      );
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      assert.ok(
        Math.abs(centerX - 96) <= 1 && Math.abs(centerY - 96) <= 1,
        `${filename} must be optically centered, got ${centerX.toFixed(2)},${centerY.toFixed(2)}`,
      );
    }
  } finally {
    await browser.close();
  }
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
    ["multimix-logo-badge-black.png", [1024, 1024]],
    ["multimix-logo-badge-white.png", [1024, 1024]],
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
